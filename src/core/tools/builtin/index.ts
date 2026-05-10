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
];
