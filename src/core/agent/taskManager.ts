import type {
  ChatMessage,
  PlanStep,
  TaskRecord,
  TaskStatus,
  TodoItem,
  ToolCallRecord,
} from "../../shared/types";

export interface TaskCreateInput {
  prompt: string;
  modeId: string;
  providerId: string;
  modelId: string;
  activeSkills?: string[];
  title?: string;
}

/**
 * In-memory task store. The extension persists the latest N tasks to
 * `globalState` via `SessionStore` for "recent tasks" UI; this manager owns
 * the live mutable task representation while the agent loop is running.
 */
export class TaskManager {
  private tasks = new Map<string, TaskRecord>();
  private currentId: string | undefined;
  private listeners = new Set<(task: TaskRecord) => void>();

  onUpdate(fn: (task: TaskRecord) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  current(): TaskRecord | undefined {
    return this.currentId ? this.tasks.get(this.currentId) : undefined;
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  create(input: TaskCreateInput): TaskRecord {
    const id = makeTaskId();
    const task: TaskRecord = {
      id,
      title: input.title ?? deriveTitle(input.prompt),
      prompt: input.prompt,
      modeId: input.modeId,
      activeSkills: input.activeSkills ?? [],
      providerId: input.providerId,
      modelId: input.modelId,
      status: "pending",
      toolCalls: [],
      messages: [],
      startedAt: Date.now(),
    };
    this.tasks.set(id, task);
    this.currentId = id;
    this.emit(task);
    return task;
  }

  update(id: string, patch: Partial<TaskRecord>): TaskRecord | undefined {
    const t = this.tasks.get(id);
    if (!t) return undefined;
    Object.assign(t, patch);
    this.emit(t);
    return t;
  }

  setStatus(id: string, status: TaskStatus): TaskRecord | undefined {
    return this.update(id, {
      status,
      ...(status === "completed" || status === "failed" || status === "cancelled"
        ? { endedAt: Date.now() }
        : {}),
    });
  }

  appendMessage(id: string, msg: ChatMessage): TaskRecord | undefined {
    const t = this.tasks.get(id);
    if (!t) return undefined;
    t.messages.push(msg);
    this.emit(t);
    return t;
  }

  recordToolCall(id: string, call: ToolCallRecord): TaskRecord | undefined {
    const t = this.tasks.get(id);
    if (!t) return undefined;
    const i = t.toolCalls.findIndex((c) => c.id === call.id);
    if (i >= 0) t.toolCalls[i] = call;
    else t.toolCalls.push(call);
    this.emit(t);
    return t;
  }

  setPlan(id: string, plan: PlanStep[]): TaskRecord | undefined {
    return this.update(id, { plan });
  }

  setTodo(id: string, todo: TodoItem[]): TaskRecord | undefined {
    return this.update(id, { todo });
  }

  clearCurrent(): void {
    this.currentId = undefined;
  }

  private emit(task: TaskRecord): void {
    for (const fn of this.listeners) fn(task);
  }
}

function makeTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function deriveTitle(prompt: string): string {
  const first = prompt.trim().split(/\n/, 1)[0]?.slice(0, 80) ?? "untitled";
  return first.length === 0 ? "untitled" : first;
}
