import { create } from "zustand";
import type { AppState } from "../../shared/types";
import type { HostToWebview, WebviewToHost } from "../../shared/protocol";
import { vscode } from "../bridge/vscode";

export type ViewId =
  | "chat"
  | "tasks"
  | "usage"
  | "diff"
  | "settings"
  | "providers"
  | "mcp"
  | "skills"
  | "modes";

const defaultState: AppState = {
  ready: false,
  settings: {
    defaultProviderId: "openai-compatible",
    defaultModelId: "gpt-4o-mini",
    approvalPolicy: "balanced",
    reasoningEffort: "medium",
    enableMcp: true,
    enableSkills: true,
    enableBrowserTools: false,
    enableSemanticIndex: false,
    embeddingProvider: "",
    embeddingModel: "",
    embeddingDimensions: undefined,
    embeddingMaxChunkChars: 4000,
    ui: { theme: "system", compactMode: false, animations: true },
    queue: {
      enabled: true,
      autoSendNext: true,
      allowInterrupt: true,
      preserveContext: true,
      summarizePreviousRun: true,
    },
    checkpoints: { enabled: true, maxCount: 50 },
    ignorePatterns: [],
    customInstructions: "",
  },
  providers: [],
  models: {},
  modes: [],
  skills: [],
  mcpServers: [],
  mcpTools: [],
  currentMode: "code",
  recentTasks: [],
  queue: [],
  queuePaused: false,
  agentBusy: false,
  workspaceTrusted: true,
};

interface AppStore {
  state: AppState;
  activeView: ViewId;
  toasts: { id: string; level: "info" | "success" | "warn" | "error"; message: string }[];
  setView: (v: ViewId) => void;
  initialize: () => void;
  send: (msg: WebviewToHost) => void;
  pushToast: (level: "info" | "success" | "warn" | "error", message: string) => void;
  dismissToast: (id: string) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  state: defaultState,
  activeView: "chat",
  toasts: [],
  setView: (v) => set({ activeView: v }),
  initialize: () => {
    window.addEventListener("message", (e) => {
      const msg = e.data as HostToWebview;
      handleHostMessage(msg, set, get);
    });
    vscode.postMessage({ type: "ui/ready" });
  },
  send: (msg) => vscode.postMessage(msg),
  pushToast: (level, message) =>
    set((s) => ({
      toasts: [...s.toasts, { id: cryptoRandom(), level, message }],
    })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

function handleHostMessage(
  msg: HostToWebview,
  set: (partial: Partial<AppStore> | ((s: AppStore) => Partial<AppStore>)) => void,
  get: () => AppStore,
) {
  switch (msg.type) {
    case "state/replace":
      set({ state: msg.state });
      break;
    case "state/patch":
      set((s) => ({ state: { ...s.state, ...msg.patch } }));
      break;
    case "task/update": {
      set((s) => {
        const task = msg.task;
        const recents = s.state.recentTasks.filter((t) => t.id !== task.id);
        return {
          state: {
            ...s.state,
            currentTask: task,
            recentTasks: [task, ...recents].slice(0, 30),
          },
        };
      });
      break;
    }
    case "task/streamDelta": {
      set((s) => {
        const task = s.state.currentTask;
        if (!task || task.id !== msg.taskId) return {};
        const idx = task.messages.findIndex((m) => m.id === msg.messageId);
        let messages = task.messages.slice();
        if (idx >= 0) {
          messages[idx] = { ...messages[idx], content: messages[idx].content + msg.delta };
        } else {
          messages = [
            ...messages,
            {
              id: msg.messageId,
              role: "assistant",
              content: msg.delta,
              ts: Date.now(),
            },
          ];
        }
        return { state: { ...s.state, currentTask: { ...task, messages } } };
      });
      break;
    }
    case "approval/request":
      set((s) => ({ state: { ...s.state, pendingApproval: msg.req } }));
      break;
    case "diff/show":
      set((s) => ({ state: { ...s.state, diff: { taskId: msg.taskId, files: msg.files } } }));
      break;
    case "diff/clear":
      set((s) => ({ state: { ...s.state, diff: undefined } }));
      break;
    case "toast":
      get().pushToast(msg.level, msg.message);
      break;
    case "log":
      // eslint-disable-next-line no-console
      console[msg.level === "error" ? "error" : msg.level === "warn" ? "warn" : "log"]("[nexus]", msg.message);
      break;
    default:
      break;
  }
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 10);
}
