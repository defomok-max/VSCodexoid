/**
 * In-memory ring buffer of recent `run_terminal_command` invocations. The
 * `get_terminal_output` tool reads from this so the agent can inspect output
 * from the previous step without re-running the command.
 *
 * We store at most `MAX_ENTRIES` snapshots; each snapshot is already
 * secret-redacted by `runTerminalCommandTool` before it lands here.
 */
export interface TerminalSnapshot {
  command: string;
  cwd: string | undefined;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Wall-clock timestamp (ms). */
  ts: number;
}

const MAX_ENTRIES = 16;
const buffer: TerminalSnapshot[] = [];

export function recordTerminalOutput(snapshot: TerminalSnapshot): void {
  buffer.push(snapshot);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

/**
 * Returns the last `n` snapshots, newest first. `n` defaults to 1.
 */
export function getRecentTerminalOutputs(n = 1): TerminalSnapshot[] {
  if (n <= 0) return [];
  const start = Math.max(0, buffer.length - n);
  return buffer.slice(start).reverse();
}

/** Clears the ring buffer (test helper). */
export function clearTerminalCapture(): void {
  buffer.length = 0;
}
