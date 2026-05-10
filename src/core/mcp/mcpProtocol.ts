/**
 * Minimal Model Context Protocol (MCP) message shapes. We implement only the
 * methods we need (initialize, tools/list, tools/call). The full spec is much
 * larger — additional methods can be added as we encounter servers that need
 * them.
 *
 * Reference: https://modelcontextprotocol.io
 */

export interface McpRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface McpNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface McpResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo?: { name?: string; version?: string };
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpToolsListResult {
  tools: McpToolDef[];
  nextCursor?: string;
}

export interface McpToolCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; mimeType?: string } };
