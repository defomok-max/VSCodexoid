import { z } from "zod";
import type {
  McpToolDescriptor,
  RiskLevel,
} from "../../shared/types";
import type { ToolDefinition } from "../tools/toolTypes";
import type { McpToolCallResult } from "./mcpProtocol";

/**
 * Synthetic tool id prefix. We embed both the server id and tool name in the
 * registry id so multiple servers can expose tools with the same name without
 * colliding (`mcp:filesystem:read_file` vs `mcp:notes:read_file`).
 */
const ID_PREFIX = "mcp:";

/**
 * The agent surfaces tool *names* to the LLM; many providers require names
 * to match `^[A-Za-z0-9_-]+$`. We therefore expose MCP tools as
 * `mcp_<serverId>_<toolName>` after sanitizing each component.
 */
export function mcpToolName(serverId: string, toolName: string): string {
  const safeServer = serverId.replace(/[^A-Za-z0-9_]/g, "_");
  const safeTool = toolName.replace(/[^A-Za-z0-9_]/g, "_");
  return `mcp_${safeServer}_${safeTool}`;
}

export function mcpToolId(serverId: string, toolName: string): string {
  return `${ID_PREFIX}${serverId}:${toolName}`;
}

/** True when an id was minted by `mcpToolId`. */
export function isMcpToolId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

/**
 * Bridge that lets the adapter call the matching MCP server. Provided by the
 * host so the adapter remains decoupled from `McpManager` for testing.
 */
export interface McpCallBridge {
  callTool(serverId: string, toolName: string, args: unknown, signal: AbortSignal): Promise<McpToolCallResult>;
}

/**
 * Builds a `ToolDefinition` that proxies to an MCP server tool.
 *
 *  - **Schema:** zod passthrough — MCP servers validate inputs against their
 *    own JSON Schema, so the runner does not re-validate.
 *  - **Parameters:** the descriptor's `inputSchema` (a JSON Schema fragment)
 *    is forwarded directly to the LLM.
 *  - **Risk level:** `descriptor.riskLevel ?? "medium"`. MCP tools have no
 *    static signature we can analyze so we default to `medium`, which
 *    requires explicit approval under the `manual` and `balanced` policies.
 *  - **Category:** `network` — MCP traffic always crosses a process / network
 *    boundary, so the workspace-trust gate hides MCP tools from the agent
 *    when the workspace is untrusted (matching the policy for HTTP tools).
 *
 * The `description` is enriched with `[mcp:<serverId>]` so the LLM can see
 * which server backs the call when it picks between competing tools.
 */
export function buildMcpToolDefinition(
  descriptor: McpToolDescriptor,
  bridge: McpCallBridge,
): ToolDefinition<Record<string, unknown>> {
  const { serverId, name } = descriptor;
  const description = `[mcp:${serverId}] ${descriptor.description ?? name}`;
  const parameters = (descriptor.inputSchema as Record<string, unknown> | undefined) ?? {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
  const riskLevel: RiskLevel = descriptor.riskLevel ?? "medium";
  return {
    id: mcpToolId(serverId, name),
    name: mcpToolName(serverId, name),
    description,
    schema: z.record(z.unknown()),
    parameters,
    riskLevel,
    category: "network",
    async execute(args, ctx) {
      try {
        const result = await bridge.callTool(serverId, name, args, ctx.signal);
        const text = formatMcpResult(result);
        return { content: text, error: result.isError ? "MCP server reported error" : undefined };
      } catch (e) {
        const msg = (e as Error).message;
        return { content: `[mcp:${serverId}:${name}] error: ${msg}`, error: msg };
      }
    },
  };
}

/**
 * Renders an `McpToolCallResult` into a single string for the agent
 * transcript. Multi-block content is concatenated with double newlines;
 * non-text blocks render as `[image:<mime>]` / `[resource:<uri>]` markers
 * (the bytes/URIs are not inlined to keep the transcript small).
 */
export function formatMcpResult(result: McpToolCallResult): string {
  if (!result.content?.length) return "[mcp: empty result]";
  return result.content
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "image") return `[image:${b.mimeType}]`;
      if (b.type === "resource") return `[resource:${b.resource.uri}]`;
      return `[unknown content block]`;
    })
    .join("\n\n");
}
