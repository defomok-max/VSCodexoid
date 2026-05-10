// Shared types between the extension host and the webview UI.
// Keep this file free of any vscode/node imports — it must compile in the browser.

export type Theme = "light" | "dark" | "system";

export type ReasoningEffort = "low" | "medium" | "high" | "extreme";

export type ApprovalPolicy = "manual" | "balanced" | "auto-safe" | "full-auto";

export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";

export type ProviderType =
  | "openai-compatible"
  | "anthropic"
  | "google-gemini"
  | "ollama"
  | "lm-studio"
  | "localai"
  | "azure-openai"
  | "aws-bedrock"
  | "openrouter"
  | "groq"
  | "mistral"
  | "deepseek"
  | "xai"
  | "together"
  | "fireworks"
  | "perplexity"
  | "cohere"
  | "huggingface"
  | "custom-http";

export interface ProviderProfile {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiKeySecretRef?: string;
  defaultModel?: string;
  organization?: string;
  project?: string;
  headers?: Record<string, string>;
  customParameters?: Record<string, unknown>;
  streaming?: boolean;
  toolCallingFormat?: "openai" | "anthropic" | "gemini" | "none";
  rateLimitRpm?: number;
  fallbackModel?: string;
  maxContext?: number;
  costPerMillionInput?: number;
  costPerMillionOutput?: number;
  // For custom HTTP only:
  customHttp?: {
    method: "POST" | "GET" | "PUT";
    bodyTemplate: string;
    responsePath: string;
    streamingParser?: string;
    authScheme?: "bearer" | "header" | "query" | "none";
    authParam?: string;
    staticModels?: string[];
    listModelsUrl?: string;
    listModelsPath?: string;
  };
}

export interface ModelInfo {
  id: string;
  name?: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoningEffort?: boolean;
  costPerMillionInput?: number;
  costPerMillionOutput?: number;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  ts: number;
  toolCalls?: ToolCallRef[];
  toolCallId?: string;
  attachments?: AttachmentRef[];
  reasoningSummary?: string;
}

export interface AttachmentRef {
  kind: "file" | "selection" | "image" | "url";
  path?: string;
  range?: { startLine: number; endLine: number };
  url?: string;
  mimeType?: string;
  bytes?: number;
}

export interface ToolCallRef {
  id: string;
  name: string;
  argsJson: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: unknown;
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
  resultPreview?: string;
  resultTruncated?: boolean;
  errorMessage?: string;
  approvalState?: "auto" | "approved" | "rejected" | "pending";
  riskLevel?: RiskLevel;
}

export type TaskStatus =
  | "pending"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export interface TodoItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
}

export interface PlanStep {
  id: string;
  title: string;
  rationale?: string;
  toolHint?: string;
  expectedFiles?: string[];
  riskLevel?: RiskLevel;
}

export interface TaskRecord {
  id: string;
  title: string;
  prompt: string;
  modeId: string;
  activeSkills: string[];
  providerId: string;
  modelId: string;
  status: TaskStatus;
  plan?: PlanStep[];
  todo?: TodoItem[];
  toolCalls: ToolCallRecord[];
  messages: ChatMessage[];
  startedAt: number;
  endedAt?: number;
  inputTokens?: number;
  outputTokens?: number;
  finalSummary?: string;
}

export type QueueItemStatus = "queued" | "next" | "sent" | "cancelled" | "failed";

export type QueueSendBehavior =
  | "append-followup"
  | "interrupt-current"
  | "high-priority-next"
  | "incorporate-into-plan";

export interface QueueItem {
  id: string;
  text: string;
  attachments?: AttachmentRef[];
  contextRefs?: string[];
  createdAt: number;
  priority: number;
  status: QueueItemStatus;
  modeOverride?: string;
  providerOverride?: string;
  modelOverride?: string;
  sendBehavior?: QueueSendBehavior;
}

export interface ModeProfile {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  allowedSkills?: string[] | "*";
  allowedMcpServers?: string[] | "*";
  defaultProviderId?: string;
  defaultModelId?: string;
  reasoningEffort: ReasoningEffort;
  temperature?: number;
  approvalPolicy: ApprovalPolicy;
  maxFilesPerTurn?: number;
  maxCommandRuntimeMs?: number;
  riskTolerance: RiskLevel;
  builtIn?: boolean;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  triggers?: string[];
  instructions?: string[];
  workflow?: string[];
  examples?: { input: string; output: string }[];
  allowedTools?: string[];
  requiredMcpServers?: string[];
  requiredFiles?: string[];
  templates?: Record<string, string>;
  outputFormat?: string;
  safetyConstraints?: string[];
  modeCompatibility?: string[];
  providerPreferences?: string[];
  enabled?: boolean;
  builtIn?: boolean;
  source?: "built-in" | "user" | "project";
}

export type McpServerType = "stdio" | "http" | "sse";

export interface McpServerConfig {
  id: string;
  name?: string;
  type: McpServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  autoStart?: boolean;
}

export interface McpToolDescriptor {
  serverId: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
  riskLevel?: RiskLevel;
  enabled: boolean;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  argsPreview: string;
  riskLevel: RiskLevel;
  rationale?: string;
  affectedFiles?: string[];
  command?: string;
  cwd?: string;
}

export interface ApprovalDecision {
  id: string;
  approved: boolean;
  rememberSession?: boolean;
}

export interface CheckpointMeta {
  id: string;
  taskId?: string;
  createdAt: number;
  label?: string;
  files: { path: string; bytes: number }[];
}

export interface NexusSettings {
  defaultProviderId: string;
  defaultModelId: string;
  approvalPolicy: ApprovalPolicy;
  reasoningEffort: ReasoningEffort;
  enableMcp: boolean;
  enableSkills: boolean;
  enableBrowserTools: boolean;
  ui: {
    theme: Theme;
    compactMode: boolean;
    animations: boolean;
  };
  queue: {
    enabled: boolean;
    autoSendNext: boolean;
    allowInterrupt: boolean;
    preserveContext: boolean;
    summarizePreviousRun: boolean;
  };
  checkpoints: { enabled: boolean; maxCount: number };
  ignorePatterns: string[];
  customInstructions: string;
}

export interface AppState {
  ready: boolean;
  settings: NexusSettings;
  providers: ProviderProfile[];
  models: Record<string, ModelInfo[]>;
  modes: ModeProfile[];
  skills: SkillDefinition[];
  mcpServers: McpServerConfig[];
  mcpTools: McpToolDescriptor[];
  currentMode: string;
  currentTask?: TaskRecord;
  recentTasks: TaskRecord[];
  queue: QueueItem[];
  queuePaused: boolean;
  agentBusy: boolean;
  pendingApproval?: ApprovalRequest;
  diff?: { taskId: string; files: DiffPreviewFile[] };
}

export interface DiffPreviewFile {
  path: string;
  before: string;
  after: string;
  hunks: DiffHunk[];
  status: "modified" | "created" | "deleted" | "renamed";
}

export interface DiffHunk {
  id: string;
  startLineBefore: number;
  startLineAfter: number;
  beforeText: string;
  afterText: string;
  accepted: boolean | null;
}
