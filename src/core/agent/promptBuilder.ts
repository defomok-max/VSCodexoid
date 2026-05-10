import type { ChatMessage as ChatMessageWebview, ModeProfile, NexusSettings, SkillDefinition } from "../../shared/types";
import { buildRulesSection } from "../rules/rulesLoader";

/**
 * Constructs the system prompt for an agent turn by stacking:
 *   1. The active mode's `systemPrompt`
 *   2. Matched skills (their `instructions[]` + `workflow`)
 *   3. The project's `.nexusrules` (already loaded)
 *   4. The user's `customInstructions` from settings
 *   5. A short summary of the available tools and their risk levels
 *
 * The agent runner uses this once per turn — when the active mode or skills
 * change between turns, we re-build it.
 */
export interface PromptInputs {
  mode: ModeProfile;
  skills: SkillDefinition[];
  rulesText?: string;
  settings: NexusSettings;
  toolsSummary?: string;
}

export function buildSystemPrompt(inputs: PromptInputs): string {
  const parts: string[] = [];
  parts.push(inputs.mode.systemPrompt.trim());
  if (inputs.skills.length > 0) {
    const skillBlocks = inputs.skills.map((s) => formatSkill(s));
    parts.push(`--- ACTIVE SKILLS ---\n${skillBlocks.join("\n\n")}\n--- END ACTIVE SKILLS ---`);
  }
  const rules = buildRulesSection(inputs.rulesText);
  if (rules) parts.push(rules);
  const ci = inputs.settings.customInstructions?.trim();
  if (ci) parts.push(`--- USER CUSTOM INSTRUCTIONS ---\n${ci}\n--- END USER CUSTOM INSTRUCTIONS ---`);
  if (inputs.toolsSummary) parts.push(inputs.toolsSummary);
  return parts.join("\n\n");
}

function formatSkill(s: SkillDefinition): string {
  const head = `## ${s.name} (${s.id})\n${s.description}`;
  const lines: string[] = [head];
  if (s.instructions && s.instructions.length > 0) {
    lines.push("Instructions:");
    for (const i of s.instructions) lines.push(`- ${i}`);
  }
  if (s.workflow && s.workflow.length > 0) {
    lines.push(`Workflow: ${s.workflow.join(" / ")}`);
  }
  if (s.outputFormat) lines.push(`Output format: ${s.outputFormat}`);
  if (s.safetyConstraints && s.safetyConstraints.length > 0) {
    lines.push("Safety constraints:");
    for (const c of s.safetyConstraints) lines.push(`- ${c}`);
  }
  return lines.join("\n");
}

/**
 * Builds the LLM-side `messages` array from the task's transcript plus the
 * fresh user turn. We strip webview-only fields (id/ts) which provider
 * adapters don't expect.
 *
 * `attachments` (e.g. inline images) are forwarded on the new user message
 * so vision-capable providers can serialize them into multimodal content
 * blocks.
 */
export function buildLlmMessages(
  systemPrompt: string,
  transcript: ChatMessageWebview[],
  userTurn: string,
  contextChunksText?: string,
  attachments?: import("../../shared/types").AttachmentRef[],
): ChatMessageWebview[] {
  const out: ChatMessageWebview[] = [];
  out.push({ id: "sys", role: "system", content: systemPrompt, ts: 0 });
  out.push(...transcript);
  const userContent =
    contextChunksText && contextChunksText.length > 0
      ? `${contextChunksText}\n\n${userTurn}`
      : userTurn;
  out.push({
    id: "u",
    role: "user",
    content: userContent,
    ts: Date.now(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  });
  return out;
}
