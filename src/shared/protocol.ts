// Message protocol between the VS Code extension host and the webview UI.
// All messages are tagged by `type` so they can be routed by either side.

import type {
  AppState,
  ApprovalDecision,
  ChatMessage,
  DiffPreviewFile,
  McpServerConfig,
  ModeProfile,
  NexusSettings,
  ProviderProfile,
  QueueItem,
  QueueSendBehavior,
  SkillDefinition,
  TaskRecord,
} from "./types";

// ─── Webview → Host ───────────────────────────────────────────────────────────

export type WebviewToHost =
  | { type: "ui/ready" }
  | { type: "task/start"; prompt: string; modeId?: string; providerId?: string; modelId?: string; sendBehavior?: QueueSendBehavior }
  | { type: "task/stop" }
  | { type: "task/pause" }
  | { type: "task/resume"; taskId?: string }
  | { type: "task/fork"; taskId: string }
  | { type: "task/clear" }
  | { type: "task/regeneratePlan"; taskId: string }
  | { type: "queue/add"; item: Omit<QueueItem, "id" | "createdAt" | "status"> }
  | { type: "queue/remove"; itemId: string }
  | { type: "queue/edit"; itemId: string; text: string }
  | { type: "queue/move"; itemId: string; direction: "up" | "down" | "top" }
  | { type: "queue/sendNow"; itemId: string; behavior: QueueSendBehavior }
  | { type: "queue/clear" }
  | { type: "queue/pause" }
  | { type: "queue/resume" }
  | { type: "approval/decide"; decision: ApprovalDecision }
  | { type: "diff/acceptHunk"; taskId: string; path: string; hunkId: string }
  | { type: "diff/rejectHunk"; taskId: string; path: string; hunkId: string }
  | { type: "diff/acceptFile"; taskId: string; path: string }
  | { type: "diff/rejectFile"; taskId: string; path: string }
  | { type: "diff/acceptAll"; taskId: string }
  | { type: "diff/rollback"; taskId: string }
  | { type: "settings/save"; partial: Partial<NexusSettings> }
  | { type: "providers/save"; profiles: ProviderProfile[] }
  | { type: "providers/secret"; profileId: string; apiKey: string }
  | { type: "providers/refreshModels"; profileId: string }
  | { type: "modes/save"; modes: ModeProfile[] }
  | { type: "modes/setActive"; modeId: string }
  | { type: "skills/save"; skills: SkillDefinition[] }
  | { type: "skills/runManually"; skillId: string }
  | { type: "mcp/save"; servers: McpServerConfig[] }
  | { type: "mcp/restart"; serverId: string }
  | { type: "mcp/test"; serverId: string }
  | { type: "checkpoint/create"; label?: string }
  | { type: "checkpoint/restore"; checkpointId: string }
  | { type: "command/run"; command: string };

// ─── Host → Webview ───────────────────────────────────────────────────────────

export type HostToWebview =
  | { type: "state/replace"; state: AppState }
  | { type: "state/patch"; patch: Partial<AppState> }
  | { type: "task/message"; message: ChatMessage }
  | { type: "task/update"; task: TaskRecord }
  | { type: "task/streamDelta"; taskId: string; messageId: string; delta: string }
  | { type: "task/toolStart"; taskId: string; toolCallId: string; name: string; argsPreview: string }
  | { type: "task/toolEnd"; taskId: string; toolCallId: string; ok: boolean; resultPreview?: string; errorMessage?: string }
  | { type: "approval/request"; req: import("./types").ApprovalRequest }
  | { type: "diff/show"; taskId: string; files: DiffPreviewFile[] }
  | { type: "diff/clear" }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "toast"; level: "info" | "success" | "warn" | "error"; message: string };
