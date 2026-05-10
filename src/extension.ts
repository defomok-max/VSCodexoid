import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildToolUiBridge } from "./core/tools/uiBridgeAdapter";
import { NexusWebviewProvider } from "./webview/webviewProvider";
import { SettingsStore } from "./core/storage/settingsStore";
import { SessionStore } from "./core/storage/sessionStore";
import { QueueStore } from "./core/storage/queueStore";
import { PreferencesStore } from "./core/storage/preferencesStore";
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
import { McpConfigStore } from "./core/storage/mcpConfigStore";
import { reconcileMcpLifecycle, restartMcpServer } from "./core/mcp/mcpLifecycle";
import { reconcileMcpTools } from "./core/mcp/mcpToolReconciler";
import { CheckpointManager } from "./core/checkpoint/checkpointManager";
import { WorkspaceIndex } from "./core/indexing/workspaceIndex";
import { QueueManager } from "./core/agent/queueManager";
import { TaskManager } from "./core/agent/taskManager";
import { ApprovalGate } from "./core/agent/approvalGate";
import { runAgent } from "./core/agent/agentRunner";
import { parseContextRefs, stripContextRefs } from "./core/context/contextRef";
import { buildContextChunks, packContext } from "./core/context/contextBuilder";
import { loadNexusRules } from "./core/rules/rulesLoader";
import {
  isDiffSessionResolved,
  materializeAcceptedFiles,
  setAllDecision,
  setFileDecision,
  setHunkDecision,
  type DiffSession,
} from "./core/edit/diffSession";
import type {
  AppState,
  AttachmentRef,
  ChatMessage,
  DiffPreviewFile,
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
  const preferencesStore = new PreferencesStore(context.globalState);
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
  const mcpConfigStore = new McpConfigStore(context.globalState, wsRoot);
  let mcpServers: import("./shared/types").McpServerConfig[] = [];
  const mcpCallBridge = {
    async callTool(serverId: string, toolName: string, args: unknown, signal: AbortSignal) {
      const client = mcpManager.getClient(serverId);
      if (!client) throw new Error(`mcp server ${serverId} not running`);
      // Honor task cancellation: race the call against the abort signal so a
      // long-running MCP tool does not block task abort.
      const callP = client.callTool(toolName, args);
      if (!signal) return callP;
      return await Promise.race([
        callP,
        new Promise<never>((_, reject) => {
          const onAbort = () => reject(new Error("aborted"));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    },
  };
  mcpManager.setListeners({
    tools: (descriptors) => {
      mcpTools.length = 0;
      mcpTools.push(...descriptors);
      const summary = reconcileMcpTools(toolRegistry, descriptors, mcpCallBridge);
      logger.info(
        `mcp tools reconciled: +${summary.added} -${summary.removed} =${summary.kept}`,
      );
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

  const queueStore = new QueueStore(context.globalState);
  const queueManager = new QueueManager();
  const taskManager = new TaskManager();
  const approvalGate = new ApprovalGate();
  let diffSession: DiffSession | undefined;
  let activeRunController: AbortController | undefined;

  // Hydrate task history from persisted globalState so "recent tasks" survives
  // an extension reload.
  taskManager.seed(sessionStore.recentTasks());

  // Hydrate queue state from globalState so pending follow-ups and the paused
  // flag survive a reload, then mirror every mutation back to disk.
  const persistedQueue = queueStore.read();
  queueManager.hydrate(persistedQueue.items, persistedQueue.paused);
  queueManager.onChange(() => {
    void queueStore.save(queueManager.list(), queueManager.isPaused()).catch((e) =>
      logger.warn(`queue persist failed: ${(e as Error).message}`),
    );
  });

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

  // Restore the last-used mode (defaults to "code" on first launch). Without
  // this, switching to e.g. "architect" gets reset every time the extension
  // host reloads, which is surprising.
  let currentModeId = preferencesStore.read().currentMode ?? "code";

  const buildState = (): AppState => ({
    ready: true,
    settings: settingsStore.read(),
    providers: providerRegistry.list(),
    models: { ...modelCache },
    modes: builtInModes,
    skills: skillRegistry.list(),
    mcpServers: [...mcpServers],
    mcpTools: [...mcpTools],
    currentMode: currentModeId,
    currentTask: taskManager.current(),
    recentTasks: taskManager.list(),
    queue: queueManager.list(),
    queuePaused: queueManager.isPaused(),
    agentBusy: !!activeRunController,
    workspaceTrusted: vscode.workspace.isTrusted,
    diff: diffSession ? { taskId: diffSession.taskId, files: diffSession.files } : undefined,
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
    getDiffSession: () => diffSession,
    setDiffSession: (session: DiffSession | undefined) => {
      diffSession = session;
    },
    mcpManager,
    mcpConfigStore,
    getMcpServers: () => [...mcpServers],
    setMcpServers: (s) => {
      mcpServers = s;
    },
    sessionStore,
    workspaceIndex,
    workspaceRoot: wsRoot,
    getActiveRun: () => activeRunController,
    setActiveRun: (c: AbortController | undefined) => {
      activeRunController = c;
    },
    setCurrentMode: (id: string) => {
      currentModeId = id;
      // Fire-and-forget: failing to persist is non-fatal (next reload would
      // just see the previous mode); we log via the surrounding handler.
      void preferencesStore.update({ currentMode: id });
    },
    getCurrentMode: () => currentModeId,
  };
  void runnerDeps;
  void buildSecurityBridge;

  context.subscriptions.push({ dispose: () => void mcpManager.stopAll() });

  // Hydrate MCP config + auto-start runnable servers.
  void (async () => {
    try {
      mcpServers = await mcpConfigStore.read();
      post({ type: "state/patch", patch: { mcpServers: [...mcpServers] } });
      const summary = await reconcileMcpLifecycle(mcpManager, mcpServers);
      if (summary.started || summary.stopped) {
        logger.info(`mcp lifecycle: started ${summary.started}, stopped ${summary.stopped}`);
      }
    } catch (e) {
      logger.warn(`mcp hydrate failed: ${(e as Error).message}`);
    }
  })();

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
  getDiffSession: () => DiffSession | undefined;
  setDiffSession: (session: DiffSession | undefined) => void;
  mcpManager: McpManager;
  mcpConfigStore: McpConfigStore;
  getMcpServers: () => import("./shared/types").McpServerConfig[];
  setMcpServers: (s: import("./shared/types").McpServerConfig[]) => void;
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
        if (popped.behavior === "high-priority-next") {
          post({ type: "state/patch", patch: { queue: deps.runnerDeps.queueManager.list() } });
        } else if (popped.behavior === "interrupt-current") {
          const active = deps.runnerDeps.getActiveRun();
          if (active) {
            deps.runnerDeps.queueManager.add({
              text: popped.item.text,
              priority: Math.max((popped.item.priority ?? 0) + 1, Date.now()),
              attachments: popped.item.attachments,
              contextRefs: popped.item.contextRefs,
              modeOverride: popped.item.modeOverride,
              providerOverride: popped.item.providerOverride,
              modelOverride: popped.item.modelOverride,
            });
            active.abort();
            deps.runnerDeps.approvalGate.cancelAll("interrupted");
            post({ type: "state/patch", patch: { queue: deps.runnerDeps.queueManager.list() } });
          } else {
            await startTask(
              popped.item.text,
              popped.item.modeOverride,
              popped.item.providerOverride,
              popped.item.modelOverride,
              deps,
              popped.item.attachments,
            );
          }
        } else {
          const text =
            popped.behavior === "incorporate-into-plan"
              ? `Incorporate this follow-up into the current plan:\n\n${popped.item.text}`
              : popped.item.text;
          if (deps.runnerDeps.getActiveRun()) {
            deps.runnerDeps.queueManager.add({
              text,
              priority: popped.item.priority ?? 0,
              attachments: popped.item.attachments,
              contextRefs: popped.item.contextRefs,
              modeOverride: popped.item.modeOverride,
              providerOverride: popped.item.providerOverride,
              modelOverride: popped.item.modelOverride,
            });
            post({ type: "state/patch", patch: { queue: deps.runnerDeps.queueManager.list() } });
          } else {
            await startTask(
              text,
              popped.item.modeOverride,
              popped.item.providerOverride,
              popped.item.modelOverride,
              deps,
              popped.item.attachments,
            );
          }
        }
      }
      return;
    }
    case "diff/acceptHunk": {
      const session = deps.runnerDeps.getDiffSession();
      if (!session || session.taskId !== msg.taskId) return;
      const next = setHunkDecision(session, msg.path, msg.hunkId, true).session;
      await updateDiffSession(next, deps);
      return;
    }
    case "diff/rejectHunk": {
      const session = deps.runnerDeps.getDiffSession();
      if (!session || session.taskId !== msg.taskId) return;
      const next = setHunkDecision(session, msg.path, msg.hunkId, false).session;
      await updateDiffSession(next, deps);
      return;
    }
    case "diff/acceptFile": {
      const session = deps.runnerDeps.getDiffSession();
      if (!session || session.taskId !== msg.taskId) return;
      const next = setFileDecision(session, msg.path, true).session;
      await updateDiffSession(next, deps);
      return;
    }
    case "diff/rejectFile": {
      const session = deps.runnerDeps.getDiffSession();
      if (!session || session.taskId !== msg.taskId) return;
      const next = setFileDecision(session, msg.path, false).session;
      await updateDiffSession(next, deps);
      return;
    }
    case "diff/acceptAll": {
      const session = deps.runnerDeps.getDiffSession();
      if (!session || session.taskId !== msg.taskId) return;
      await updateDiffSession(setAllDecision(session, true), deps);
      return;
    }
    case "diff/rollback": {
      const session = deps.runnerDeps.getDiffSession();
      if (!session || session.taskId !== msg.taskId) return;
      deps.runnerDeps.setDiffSession(undefined);
      post({ type: "diff/clear" });
      post({ type: "toast", level: "info", message: "Pending diff discarded." });
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
    case "mcp/save": {
      // Persist user-scope only; project-file entries are read-only and
      // re-merged on the next read().
      await deps.runnerDeps.mcpConfigStore.write(msg.servers);
      const merged = await deps.runnerDeps.mcpConfigStore.read();
      deps.runnerDeps.setMcpServers(merged);
      const summary = await reconcileMcpLifecycle(deps.runnerDeps.mcpManager, merged);
      logger.info(`mcp/save: started ${summary.started}, stopped ${summary.stopped}`);
      post({ type: "state/patch", patch: { mcpServers: merged } });
      post({
        type: "toast",
        level: "success",
        message: `MCP servers saved (${summary.started} started, ${summary.stopped} stopped).`,
      });
      return;
    }
    case "mcp/restart": {
      const cfg = deps.runnerDeps.getMcpServers().find((s) => s.id === msg.serverId);
      if (!cfg) {
        post({ type: "toast", level: "error", message: `MCP server ${msg.serverId} not found.` });
        return;
      }
      await restartMcpServer(deps.runnerDeps.mcpManager, cfg);
      post({ type: "toast", level: "info", message: `MCP server ${cfg.name ?? cfg.id} restarted.` });
      return;
    }
    case "mcp/test": {
      const cfg = deps.runnerDeps.getMcpServers().find((s) => s.id === msg.serverId);
      if (!cfg) {
        post({ type: "toast", level: "error", message: `MCP server ${msg.serverId} not found.` });
        return;
      }
      const wasRunning = deps.runnerDeps.mcpManager.getClient(cfg.id)?.isRunning() ?? false;
      try {
        if (!wasRunning) await deps.runnerDeps.mcpManager.startServer(cfg);
        const client = deps.runnerDeps.mcpManager.getClient(cfg.id);
        if (!client) throw new Error("server failed to start");
        const tools = await client.listTools();
        post({
          type: "toast",
          level: "success",
          message: `MCP ${cfg.name ?? cfg.id} OK — ${tools.tools.length} tool(s).`,
        });
      } catch (e) {
        post({
          type: "toast",
          level: "error",
          message: `MCP ${cfg.name ?? cfg.id} test failed: ${(e as Error).message}`,
        });
      } finally {
        if (!wasRunning) {
          // Don't leave an unrequested server running after a probe.
          await deps.runnerDeps.mcpManager.stopServer(cfg.id).catch(() => {});
        }
      }
      return;
    }
    default:
      // Other messages are accepted silently; later stages add real handlers.
      return;
  }
}

async function updateDiffSession(session: DiffSession | undefined, deps: MessageDeps): Promise<void> {
  const { post, runnerDeps } = deps;
  if (!session) {
    runnerDeps.setDiffSession(undefined);
    post({ type: "diff/clear" });
    return;
  }
  runnerDeps.setDiffSession(session);
  post({ type: "diff/show", taskId: session.taskId, files: session.files });
  if (!isDiffSessionResolved(session)) return;
  const acceptedFiles = materializeAcceptedFiles(session);
  if (acceptedFiles.length === 0) {
    runnerDeps.setDiffSession(undefined);
    post({ type: "diff/clear" });
    post({ type: "toast", level: "info", message: "Diff rejected; no files changed." });
    return;
  }
  try {
    const security = buildSecurityBridge(runnerDeps.workspaceRoot);
    const checkpointFiles = await readCheckpointFiles(acceptedFiles, security);
    await runnerDeps.checkpointManager.create("before accepting diff", session.taskId, checkpointFiles);
    await writeAcceptedFiles(acceptedFiles, runnerDeps.workspaceRoot, security);
    runnerDeps.setDiffSession(undefined);
    post({ type: "diff/clear" });
    post({ type: "toast", level: "success", message: `Applied ${acceptedFiles.length} accepted file(s).` });
  } catch (e) {
    post({ type: "toast", level: "error", message: `Apply diff failed: ${(e as Error).message}` });
  }
}

async function readCheckpointFiles(
  files: DiffPreviewFile[],
  security: ReturnType<typeof buildSecurityBridge>,
): Promise<{ path: string; content: string }[]> {
  const snapshots: { path: string; content: string }[] = [];
  for (const file of files) {
    const abs = security.resolveWorkspacePath(file.path);
    if (security.isIgnored(abs)) throw new Error(`path "${file.path}" is ignored by .nexusignore`);
    let content = "";
    try {
      content = await fs.readFile(abs, "utf8");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw err;
      content = CheckpointManager.MISSING_FILE_SENTINEL;
    }
    snapshots.push({ path: file.path, content });
  }
  return snapshots;
}

async function writeAcceptedFiles(
  files: DiffPreviewFile[],
  workspaceRoot: string | undefined,
  security: ReturnType<typeof buildSecurityBridge>,
): Promise<void> {
  if (!workspaceRoot) throw new Error("no workspace root — cannot apply diff");
  for (const file of files) {
    const abs = security.resolveWorkspacePath(file.path);
    if (security.isIgnored(abs)) throw new Error(`path "${file.path}" is ignored by .nexusignore`);
    if (file.after === "") {
      await fs.rm(abs, { force: true });
      continue;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, file.after, "utf8");
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
        runnerDeps.setDiffSession({ taskId: task.id, files: ev.files });
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
    void runQueuedNext(deps);
  }
}

async function runQueuedNext(deps: MessageDeps): Promise<void> {
  const { runnerDeps } = deps;
  const settings = runnerDeps.settingsStore.read();
  if (runnerDeps.getActiveRun() || !settings.queue.enabled || !settings.queue.autoSendNext) return;
  const next = runnerDeps.queueManager.popNext();
  if (!next) return;
  await startTask(
    next.text,
    next.modeOverride,
    next.providerOverride,
    next.modelOverride,
    deps,
    next.attachments,
  );
}

export function deactivate(): void {
  logger.info("deactivating NexusCode Agent");
}
