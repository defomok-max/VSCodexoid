import { ToolRegistry } from "../toolRegistry";
import {
  createFileTool,
  deleteFileTool,
  editFileTool,
  listFilesTool,
  readFileTool,
  renameFileTool,
  writeFileTool,
} from "./fileTools";
import { grepTool, searchFilesTool } from "./searchTools";
import { runTerminalCommandTool } from "./terminalTool";
import {
  gitCommitTool,
  gitCreateBranchTool,
  gitDiffTool,
  gitStageTool,
  gitStatusTool,
} from "./gitTools";
import {
  getDiagnosticsTool,
  getOpenFilesTool,
  getSelectionTool,
  getSymbolsTool,
  getTerminalOutputTool,
} from "./workspaceTools";
import {
  createCheckpointTool,
  listCheckpointsTool,
  restoreCheckpointTool,
  rollbackCheckpointTool,
} from "./checkpointTools";
import {
  askUserTool,
  queueMessageTool,
  showDiffTool,
  summarizeSessionTool,
  updateTodoListTool,
} from "./flowTools";
import {
  applyPatchTool,
  formatFilesTool,
  installDependencyTool,
  runTestCommandTool,
} from "./buildTools";

export function registerBuiltinTools(reg: ToolRegistry): void {
  reg.register(readFileTool);
  reg.register(listFilesTool);
  reg.register(writeFileTool);
  reg.register(editFileTool);
  reg.register(createFileTool);
  reg.register(deleteFileTool);
  reg.register(renameFileTool);

  reg.register(searchFilesTool);
  reg.register(grepTool);

  reg.register(runTerminalCommandTool);

  reg.register(gitStatusTool);
  reg.register(gitDiffTool);
  reg.register(gitCreateBranchTool);
  reg.register(gitStageTool);
  reg.register(gitCommitTool);

  reg.register(getOpenFilesTool);
  reg.register(getSelectionTool);
  reg.register(getDiagnosticsTool);
  reg.register(getSymbolsTool);
  reg.register(getTerminalOutputTool);

  reg.register(createCheckpointTool);
  reg.register(listCheckpointsTool);
  reg.register(restoreCheckpointTool);
  reg.register(rollbackCheckpointTool);

  reg.register(askUserTool);
  reg.register(showDiffTool);
  reg.register(updateTodoListTool);
  reg.register(queueMessageTool);
  reg.register(summarizeSessionTool);

  reg.register(applyPatchTool);
  reg.register(formatFilesTool);
  reg.register(runTestCommandTool);
  reg.register(installDependencyTool);
}

export const BUILTIN_TOOL_IDS = [
  "read_file",
  "list_files",
  "write_file",
  "edit_file",
  "create_file",
  "delete_file",
  "rename_file",
  "search_files",
  "grep",
  "run_terminal_command",
  "get_git_status",
  "get_git_diff",
  "create_git_branch",
  "stage_files",
  "commit_changes",
  "get_open_files",
  "get_selection",
  "get_diagnostics",
  "get_symbols",
  "get_terminal_output",
  "create_checkpoint",
  "list_checkpoints",
  "restore_checkpoint",
  "rollback_checkpoint",
  "ask_user",
  "show_diff",
  "update_todo_list",
  "queue_message",
  "summarize_session",
  "apply_patch",
  "format_files",
  "run_test_command",
  "install_dependency",
];
