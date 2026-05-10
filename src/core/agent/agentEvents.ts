import type { ApprovalRequest, DiffPreviewFile, RiskLevel } from "../../shared/types";

/**
 * Stream events produced by the agent runner. The host extension routes them
 * to the webview as protocol messages.
 */
export type AgentEvent =
  | { type: "task_start"; taskId: string }
  | { type: "thinking"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "message_complete"; messageId: string; text: string; reasoning?: string }
  | {
      type: "tool_call_start";
      toolCallId: string;
      name: string;
      argsPreview: string;
      risk: RiskLevel;
    }
  | { type: "tool_pending_approval"; req: ApprovalRequest }
  | { type: "tool_call_end"; toolCallId: string; ok: boolean; resultPreview: string; errorMessage?: string }
  | { type: "diff"; files: DiffPreviewFile[] }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "task_end"; taskId: string; reason: "completed" | "stopped" | "failed"; summary?: string }
  | { type: "error"; message: string };
