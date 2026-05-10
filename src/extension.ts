import * as vscode from "vscode";
import { buildToolUiBridge } from "./core/tools/uiBridgeAdapter";
import { NexusWebviewProvider } from "./webview/webviewProvider";
import { SettingsStore } from "./core/storage/settingsStore";
import { SessionStore } from "./core/storage/sessionStore";
import { builtInModes } from "./core/modes/builtInModes";
import { ProviderRegistry } from "./core/providers/providerRegistry";
import { ProviderProfileStore } from "./core/providers/providerStore";
import { ProviderSecretStore } from "./core/providers/secretStore";
import { ProviderError } from "./core/providers/providerTypes";
import { ToolRegistry } from "./core/tools/toolRegistry";
import { registerBuiltinTools } from "./core/tools/builtin";
import { IgnoreMatcher, SAFE_DEFAULT_IGNORES } from "./core/security/ignoreMatcher";
import { scanSecrets } from "./core/security/secretScanner";
import { resolveWorkspacePath } from "./core/security/pathGuard";
import { isAllowedWebviewCommand } from "./core/security/commandAllowlist";
import { SkillRegistry } from "./core/skills/skillRegistry";
import { BUILT_IN_SKILLS } from "./core/skills/builtInSkills";
import { loadProjectSkills } from "./core/skills/skillLoader";
import { McpManager } from "./core/mcp/mcpManager";
import { CheckpointManager } from "./core/checkpoint/checkpointManager";
import { WorkspaceIndex } from "./core/indexing/workspaceIndex";
import { QueueManager } from "./core/agent/queueManager";
import { TaskManager } from "./core/agent/taskManager";
import { ApprovalGate } from "./core/agent/approvalGate";
import { runAgent } from "./core/agent/agentRunner";
import { parseContextRefs, stripContextRefs } from "./core/context/contextRef";
import { buildContextChunks, packContext } from "./core/context/contextBuilder";
import { loadNexusRules } from "./core/rules/rulesLoader";
import type {
  AppState,
  AttachmentRef,
  ChatMessage,
  McpToolDescriptor,
  ModelInfo,
  ProviderProfile,
  RiskLevel,
  TaskRecord,
} from "./shared/types";
import type { HostToWebview, WebviewToHost } from "./shared/protocol";
import { logger } from "./core/util/logger";
import { registerCommands } from "./commands";

/**
 * Extension activation. Wires up:
 *   - the sidebar webview provider
 *   - the settings store (reads `nexus.*` configuration)
 *   - the session store (recent task persistence)
 *   - VS Code commands
 *
 * The agent loop, providers, tools, MCP and skills are intentionally registered
 * lazily during the next stages — this is the scaffold pass that just gets the
 * UI to mount and round-trip messages.
 */
export function activate(context: vscode.ExtensionContext): void {
  logger.info("activating NexusCode Agent");

  const settingsStore = new SettingsStore();
  const sessionStore = new SessionStore(context.globalState);
  const providerProfileStore = new ProviderProfileStore(context.globalState);
  const providerSecretStore = new ProviderSecretStore(context.secrets);
  const providerRegistry = new ProviderRegistry();
  providerRegistry.setProfiles(providerProfileStore.read());
  const modelCache: Record<string, ModelInfo[]> = {};

  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry);

  const skillRegistry = new SkillRegistry();
  skillRegistry.registerMany(BUILT_IN_SKILLS);
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsRoot) {
    const project = loadProjectSkills(wsRoot);
    skillRegistry.registerMany(project.skills);
    if (project.errors.length > 0) {
      for (const err of project.errors) logger.warn(`skill load failed: ${err.file}: ${err.error}`);
    }
  }

  const mcpTools: McpToolDescriptor[] = [];
  const mcpManager = new McpManager();
  mcpManager.setListeners({
    tools: (descriptors) => {
      mcpTools.length = 0;
      mcpTools.push(...descriptors);
      post({ type: "state/patch", patch: { mcpTools: [...mcpTools] } });
    },
    status: (id, status, info) => {
      logger.info(`mcp ${id} → ${status}${info ? `: ${info}` : ""}`);
    },
  });

  const checkpointManager = new CheckpointManager(
    context.globalStorageUri.fsPath,
    settingsStore.read().checkpoints?.maxCount ?? 50,
  );
  void checkpointManager.init();

  const workspaceIndex = wsRoot
    ? new WorkspaceIndex(wsRoot, {
        isIgnored: (p) => buildSecurityBridge(wsRoot).isIgnored(p),
      })
    : undefined;
  if (workspaceIndex) {
    // Lazy initial scan; refreshes are cheap on warm caches.
    void workspaceIndex.refresh().catch((e) => logger.warn(`workspace index initial refresh failed: ${(e as Error).message}`));
  }

  const queueManager = new QueueManager();
  const taskManager = new TaskManager();
  const approvalGate = new ApprovalGate();
  let activeRunController: AbortController | undefined;

  // Hydrate task history from persisted globalState so "recent tasks" survives
  // an extension reload.
  taskManager.seed(sessionStore.recentTasks());

  taskManager.onUpdate((task) => {
    post({ type: "task/update", task });
    // Persist when the task reaches a terminal status. Streaming updates would
    // be too chatty; we save once per terminal transition.
    if (
      task.status === "completed" ||
      task.status === "failed" ||
      task.status === "cancelled"
    ) {
      void sessionStore.saveTask(stripTransient(task));
    }
  });
  approvalGate.onRequest((req) => {
    post({ type: "approval/request", req });
  });

  const provider = new NexusWebviewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NexusWebviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  let currentModeId = "code";

  const buildState = (): AppState => ({
    ready: true,
    settings: settingsStore.read(),
    providers: providerRegistry.list(),
    models: { ...modelCache },
    modes: builtInModes,
    skills: skillRegistry.list(),
    mcpServers: [],
    mcpTools: [...mcpTools],
    currentMode: currentModeId,
    currentTask: taskManager.current(),
    recentTasks: taskManager.list(),
    queue: queueManager.list(),
    queuePaused: queueManager.isPaused(),
    agentBusy: !!activeRunController,
    workspaceTrusted: vscode.workspace.isTrusted,
  });

  const post = (msg: HostToWebview) => provider.postMessage(msg);

  context.subscriptions.push(
    provider.onMessage(async (msg: WebviewToHost) => {
      try {
        await handleMessage(msg, {
          post,
          settingsStore,
          providerProfileStore,
          providerSecretStore,
          providerRegistry,
          modelCache,
          buildState,
          runnerDeps,
        });
      } catch (e) {
        logger.error("message handler failed", e);
        post({ type: "toast", level: "error", message: String((e as Error)?.message ?? e) });
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("nexus")) {
        post({ type: "state/patch", patch: { settings: settingsStore.read() } });
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      logger.info("workspace trust granted — unlocking full tool set");
      post({ type: "state/patch", patch: { workspaceTrusted: true } });
      post({
        type: "toast",
        level: "success",
        message: "Workspace trusted — shell, edit, and git tools are now available.",
      });
    }),
  );

  if (!vscode.workspace.isTrusted) {
    logger.info("workspace not trusted — agent restricted to read-only tools");
  }

  registerCommands(context, provider, {
    indexWorkspace: workspaceIndex
      ? async () => {
          const stats = await workspaceIndex.refresh();
          return stats;
        }
      : undefined,
  });

  // Snapshot deps for the message handler. The agent runner needs access to
  // most of the wiring, so we close over them in a single object.
  const runnerDeps: RunnerDeps = {
    toolRegistry,
    skillRegistry,
    settingsStore,
    providerRegistry,
    providerSecretStore,
    queueManager,
    taskManager,
    approvalGate,
    checkpointManager,
    mcpManager,
    sessionStore,
    workspaceIndex,
    workspaceRoot: wsRoot,
    getActiveRun: () => activeRunController,
    setActiveRun: (c: AbortController | undefined) => {
      activeRunController = c;
    },
    setCurrentMode: (id: string) => {
      currentModeId = id;
    },
    getCurrentMode: () => currentModeId,
  };
  void runnerDeps;
  void buildSecurityBridge;

  context.subscriptions.push({ dispose: () => void mcpManager.stopAll() });

  logger.info("NexusCode Agent activated");
}

/**
 * Strips fields that don't survive a reload usefully (in-flight tool args,
 * partial deltas) before writing to globalState. Reduces persisted payload
 * size and avoids confusing the UI on rehydrate.
 */
function stripTransient(task: TaskRecord): TaskRecord {
  return {
    ...task,
    toolCalls: task.toolCalls.map((c) => ({
      ...c,
      // Keep result preview short; full preview was already shown live.
      resultPreview: c.resultPreview ? c.resultPreview.slice(0, 256) : c.resultPreview,
    })),
  };
}

function buildSecurityBridge(workspaceRoot: string | undefined) {
  const matcher = new IgnoreMatcher(workspaceRoot ?? process.cwd());
  matcher.addPatterns(SAFE_DEFAULT_IGNORES.join("\n"));
  if (workspaceRoot) {
    matcher.loadFile(".nexusignore");
    matcher.loadFile(".gitignore");
  }
  return {
    isIgnored: (p: string) => matcher.isIgnored(p),
    resolveWorkspacePath: (p: string) => resolveWorkspacePath(workspaceRoot, p),
    scanSecrets: (text: string) => scanSecrets(text),
  };
}

interface RunnerDeps {
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  settingsStore: SettingsStore;
  providerRegistry: ProviderRegistry;
  providerSecretStore: ProviderSecretStore;
  queueManager: QueueManager;
  taskManager: TaskManager;
  approvalGate: ApprovalGate;
  checkpointManager: CheckpointManager;
  mcpManager: McpManager;
  sessionStore: SessionStore;
  workspaceIndex: WorkspaceIndex | undefined;
  workspaceRoot: string | undefined;
  getActiveRun: () => AbortController | undefined;
  setActiveRun: (c: AbortController | undefined) => void;
  setCurrentMode: (id: string) => void;
  getCurrentMode: () => string;
}

interface MessageDeps {
  post: (m: HostToWebview) => void;
  settingsStore: SettingsStore;
  providerProfileStore: ProviderProfileStore;
  providerSecretStore: ProviderSecretStore;
  providerRegistry: ProviderRegistry;
  modelCache: Record<string, ModelInfo[]>;
  buildState: () => AppState;
  runnerDeps: RunnerDeps;
}

async function handleMessage(msg: WebviewToHost, deps: MessageDeps): Promise<void> {
  const { post, settingsStore, providerProfileStore, providerSecretStore, providerRegistry, modelCache, buildState } =
    deps;
  switch (msg.type) {
    case "ui/ready":
      post({ type: "state/replace", state: buildState() });
      return;
    case "settings/save":
      await settingsStore.write(msg.partial);
      post({ type: "state/patch", patch: { settings: settingsStore.read() } });
      return;
    case "providers/save":
      await providerProfileStore.write(msg.profiles);
      providerRegistry.setProfiles(msg.profiles);
      post({ type: "state/patch", patch: { providers: providerRegistry.list() } });
      post({ type: "toast", level: "success", message: "Provider profiles saved." });
      return;
    case "providers/secret": {
      const profile = providerRegistry.list().find((p) => p.id === msg.profileId);
      if (!profile) {
        post({ type: "toast", level: "error", message: `Provider ${msg.profileId} not found` });
        return;
      }
      await providerSecretStore.set(profile.apiKeySecretRef ?? profile.id, msg.apiKey);
      post({ type: "toast", level: "success", message: `API key saved for ${profile.name}.` });
      return;
    }
    case "providers/refreshModels":
      try {
        const llm = providerRegistry.get(msg.profileId);
        if (!llm) throw new Error(`provider ${msg.profileId} not found`);
        const apiKey = await providerSecretStore.get(llm.profile.apiKeySecretRef ?? llm.id);
        const models = await llm.listModels({ apiKey });
        modelCache[msg.profileId] = models;
        post({ type: "state/patch", patch: { models: { ...modelCache } } });
        post({ type: "toast", level: "success", message: `Loaded ${models.length} models for ${llm.name}.` });
      } catch (e) {
        const err = e as ProviderError | Error;
        logger.error("refreshModels failed", err);
        post({
          type: "toast",
          level: "error",
          message: `Refresh models failed: ${(err as Error).message}`,
        });
      }
      return;
    case "modes/setActive":
      deps.runnerDeps.setCurrentMode(msg.modeId);
      post({ type: "state/patch", patch: { currentMode: msg.modeId } });
      return;
    case "task/start":
      await startTask(msg.prompt, msg.modeId, msg.providerId, msg.modelId, deps, msg.attachments);
      return;
    case "task/stop": {
      const c = deps.runnerDeps.getActiveRun();
      if (c) c.abort();
      deps.runnerDeps.approvalGate.cancelAll("stopped");
      return;
    }
    case "task/clear": {
      deps.runnerDeps.taskManager.clear();
      await deps.runnerDeps.sessionStore.clear();
      post({
        type: "state/patch",
        patch: { recentTasks: [], currentTask: undefined },
      });
      return;
    }
    case "approval/decide":
      deps.runnerDeps.approvalGate.decide(msg.decision);
      return;
    case "queue/add": {
      deps.runnerDeps.queueManager.add(msg.item);
      post({ type: "state/patch", patch: { queue: deps.runnerDeps.queueManager.list() } });
      return;
    }
    case "queue/remove": {
      deps.runnerDeps.queueManager.remove(msg.itemId);
      post({ type: "state/patch", patch: { queue: deps.runnerDeps.queueManager.list() } });
      return;
    }
    case "queue/edit": {
      deps.runnerDeps.queueManager.edit(msg.itemId, msg.text);
      post({ type: "state/patch", patch: { queue: deps.runnerDeps.queueManager.list() } });
      return;
    }
    case "queue/move": {
      deps.runnerDeps.queueManager.move(msg.itemId, msg.direction);
      post({ type: "state/patch", patch: { queue: deps.runnerDeps.queueManager.list() } });
      return;
    }
    case "queue/clear": {
      deps.runnerDeps.queueManager.clear();
      post({ type: "state/patch", patch: { queue: [] } });
      return;
    }
    case "queue/pause": {
      deps.runnerDeps.queueManager.setPaused(true);
      post({ type: "state/patch", patch: { queuePaused: true } });
      return;
    }
    case "queue/resume": {
      deps.runnerDeps.queueManager.setPaused(false);
      post({ type: "state/patch", patch: { queuePaused: false } });
      return;
    }
    case "queue/sendNow": {
      const popped = deps.runnerDeps.queueManager.sendNow(msg.itemId, msg.behavior);
      if (popped) {
        await startTask(popped.item.text, popped.item.modeOverride, popped.item.providerOverride, popped.item.modelOverride, deps, popped.item.attachments);
      }
      return;
    }
    case "command/run": {
      // The webview cannot call `executeCommand` directly. We forward only
      // commands on a small, deliberate allowlist (see
      // `core/security/commandAllowlist.ts`).
      if (!isAllowedWebviewCommand(msg.command)) {
        logger.warn(`webview attempted to run disallowed command: ${msg.command}`);
        post({
          type: "toast",
          level: "error",
          message: `Command "${msg.command}" is not allowed from the sidebar.`,
        });
        return;
      }
      try {
        await vscode.commands.executeCommand(msg.command);
      } catch (e) {
        post({
          type: "toast",
          level: "error",
          message: `Command "${msg.command}" failed: ${(e as Error).message}`,
        });
      }
      return;
    }
    default:
      // Other messages are accepted silently; later stages add real handlers.
      return;
  }
}

async function startTask(
  prompt: string,
  modeId: string | undefined,
  providerId: string | undefined,
  modelId: string | undefined,
  deps: MessageDeps,
  attachments?: AttachmentRef[],
): Promise<void> {
  const { post, runnerDeps } = deps;
  if (runnerDeps.getActiveRun()) {
    post({ type: "toast", level: "warn", message: "agent is already running" });
    return;
  }
  const settings = runnerDeps.settingsStore.read();
  const mode = builtInModes.find((m) => m.id === (modeId ?? runnerDeps.getCurrentMode())) ?? builtInModes[0];
  const profile: ProviderProfile | undefined =
    runnerDeps.providerRegistry.list().find((p) => p.id === (providerId ?? settings.defaultProviderId));
  if (!profile) {
    post({ type: "toast", level: "error", message: "no provider profile configured" });
    return;
  }
  const provider = runnerDeps.providerRegistry.get(profile.id);
  if (!provider) {
    post({ type: "toast", level: "error", message: `provider ${profile.id} not available` });
    return;
  }
  const apiKey = await runnerDeps.providerSecretStore.get(profile.apiKeySecretRef ?? profile.id);
  const effectiveModelId = modelId ?? settings.defaultModelId ?? profile.defaultModel ?? "";

  const refs = parseContextRefs(prompt);
  const userTurnText = stripContextRefs(prompt);
  const security = buildSecurityBridge(runnerDeps.workspaceRoot);
  const chunks = await buildContextChunks(refs, {
    workspaceRoot: runnerDeps.workspaceRoot,
    security,
  });
  const packed = packContext(chunks, 8000);
  const matchedSkills = runnerDeps.skillRegistry.match(prompt);
  const rulesText = loadNexusRules(runnerDeps.workspaceRoot);

  const task = runnerDeps.taskManager.create({
    prompt,
    modeId: mode.id,
    providerId: profile.id,
    modelId: effectiveModelId,
    activeSkills: matchedSkills.map((s) => s.id),
  });
  const userMessage: ChatMessage = {
    id: `u_${Date.now()}`,
    role: "user",
    content: prompt,
    ts: Date.now(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
  runnerDeps.taskManager.appendMessage(task.id, userMessage);
  post({ type: "task/message", message: userMessage });

  const ctrl = new AbortController();
  runnerDeps.setActiveRun(ctrl);
  post({ type: "state/patch", patch: { agentBusy: true } });

  try {
    const stream = runAgent(
      {
        taskId: task.id,
        prompt: userTurnText,
        contextChunksText: packed.text || undefined,
        mode,
        matchedSkills,
        rulesText,
        settings,
        provider,
        apiKey,
        modelId: effectiveModelId,
        policy: settings.approvalPolicy,
        attachments,
      },
      {
        toolRegistry: runnerDeps.toolRegistry,
        ui: buildToolUiBridge({
          post,
          showInputBox: (q) => vscode.window.showInputBox({ prompt: q }),
        }),
        security,
        checkpoints: {
          create: (label, taskId, files) =>
            runnerDeps.checkpointManager.create(label, taskId, files),
          restore: (id, root) => runnerDeps.checkpointManager.restore(id, root),
          list: () => runnerDeps.checkpointManager.list(),
        },
        flow: {
          setTodo: (taskId, items) => {
            runnerDeps.taskManager.setTodo(taskId, items);
          },
          enqueue: (item) => {
            const created = runnerDeps.queueManager.add({
              text: item.text,
              priority: item.priority ?? 0,
              modeOverride: item.modeOverride,
              providerOverride: item.providerOverride,
              modelOverride: item.modelOverride,
            });
            post({ type: "state/patch", patch: { queue: runnerDeps.queueManager.list() } });
            return { id: created.id, createdAt: created.createdAt };
          },
          recordSummary: (taskId, summary) => {
            runnerDeps.taskManager.update(taskId, { finalSummary: summary });
          },
        },
        index: runnerDeps.workspaceIndex
          ? {
              refresh: () => runnerDeps.workspaceIndex!.refresh(),
              stats: () => runnerDeps.workspaceIndex!.stats(),
              findSymbol: (name, opts) =>
                runnerDeps.workspaceIndex!.findSymbol(name, opts as never),
              lexicalSearch: (query, opts) => runnerDeps.workspaceIndex!.lexicalSearch(query, opts),
            }
          : undefined,
        workspaceRoot: runnerDeps.workspaceRoot,
        trusted: vscode.workspace.isTrusted,
        requestApproval: (req) => runnerDeps.approvalGate.request(req),
      },
      ctrl.signal,
    );
    for await (const ev of stream) {
      if (ev.type === "text_delta") {
        post({ type: "task/streamDelta", taskId: task.id, messageId: "current", delta: ev.text });
      } else if (ev.type === "message_complete") {
        const assistant: ChatMessage = {
          id: ev.messageId,
          role: "assistant",
          content: ev.text,
          ts: Date.now(),
          reasoningSummary: ev.reasoning,
        };
        runnerDeps.taskManager.appendMessage(task.id, assistant);
        post({ type: "task/message", message: assistant });
      } else if (ev.type === "tool_call_start") {
        runnerDeps.taskManager.recordToolCall(task.id, {
          id: ev.toolCallId,
          name: ev.name,
          args: undefined,
          startedAt: Date.now(),
          riskLevel: ev.risk as RiskLevel,
          approvalState: "pending",
        });
        post({ type: "task/toolStart", taskId: task.id, toolCallId: ev.toolCallId, name: ev.name, argsPreview: ev.argsPreview });
      } else if (ev.type === "tool_pending_approval") {
        post({ type: "approval/request", req: ev.req });
      } else if (ev.type === "tool_call_end") {
        runnerDeps.taskManager.recordToolCall(task.id, {
          id: ev.toolCallId,
          name: "",
          args: undefined,
          startedAt: Date.now() - 1,
          endedAt: Date.now(),
          ok: ev.ok,
          resultPreview: ev.resultPreview,
          errorMessage: ev.errorMessage,
        });
        post({ type: "task/toolEnd", taskId: task.id, toolCallId: ev.toolCallId, ok: ev.ok, resultPreview: ev.resultPreview, errorMessage: ev.errorMessage });
      } else if (ev.type === "diff") {
        post({ type: "diff/show", taskId: task.id, files: ev.files });
      } else if (ev.type === "task_end") {
        runnerDeps.taskManager.setStatus(task.id, ev.reason === "completed" ? "completed" : ev.reason === "stopped" ? "cancelled" : "failed");
      } else if (ev.type === "error") {
        post({ type: "toast", level: "error", message: ev.message });
      }
    }
  } catch (e) {
    post({ type: "toast", level: "error", message: (e as Error).message });
    runnerDeps.taskManager.setStatus(task.id, "failed");
  } finally {
    runnerDeps.setActiveRun(undefined);
    post({ type: "state/patch", patch: { agentBusy: false } });
  }
}

export function deactivate(): void {
  logger.info("deactivating NexusCode Agent");
}
