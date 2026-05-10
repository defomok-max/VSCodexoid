import type { ApprovalPolicy, RiskLevel } from "../../shared/types";

export type ApprovalDecisionType = "auto-approve" | "auto-reject" | "ask";

export interface ApprovalEvaluation {
  decision: ApprovalDecisionType;
  reason: string;
  effectiveRisk: RiskLevel;
}

/**
 * Maps `(policy, riskLevel)` to one of three outcomes:
 *
 *   - `auto-approve`: run without prompting the user
 *   - `auto-reject`: refuse without prompting (e.g. `manual` policy on `critical`)
 *   - `ask`: forward to the user for explicit yes/no
 *
 * The matrix is intentionally conservative: even `full-auto` rejects
 * `critical` actions automatically — there is no policy that approves
 * `rm -rf /` without a prompt.
 */
export function evaluateApproval(policy: ApprovalPolicy, risk: RiskLevel): ApprovalEvaluation {
  const lvl = riskToInt(risk);
  switch (policy) {
    case "manual":
      // Always ask, except outright reject critical.
      if (lvl >= riskToInt("critical")) {
        return { decision: "auto-reject", reason: "manual policy: critical actions blocked", effectiveRisk: risk };
      }
      return { decision: "ask", reason: "manual policy", effectiveRisk: risk };
    case "balanced":
      if (risk === "safe") return { decision: "auto-approve", reason: "safe action", effectiveRisk: risk };
      if (risk === "critical")
        return { decision: "auto-reject", reason: "balanced: critical actions blocked", effectiveRisk: risk };
      return { decision: "ask", reason: "balanced policy", effectiveRisk: risk };
    case "auto-safe":
      if (lvl <= riskToInt("low"))
        return { decision: "auto-approve", reason: "auto-safe: low risk", effectiveRisk: risk };
      if (risk === "critical")
        return { decision: "auto-reject", reason: "auto-safe: critical actions blocked", effectiveRisk: risk };
      return { decision: "ask", reason: "auto-safe: medium/high requires approval", effectiveRisk: risk };
    case "full-auto":
      if (risk === "critical")
        return { decision: "auto-reject", reason: "full-auto: critical actions still blocked", effectiveRisk: risk };
      return { decision: "auto-approve", reason: "full-auto policy", effectiveRisk: risk };
  }
}

export function riskToInt(r: RiskLevel): number {
  switch (r) {
    case "safe":
      return 0;
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "critical":
      return 4;
  }
}

/**
 * Heuristics for elevating risk based on a tool call's args. Used by tools
 * whose risk depends on the action (e.g. `run_terminal_command`).
 */
export const DANGEROUS_COMMAND_PATTERNS: { pattern: RegExp; risk: RiskLevel; reason: string }[] = [
  { pattern: /\brm\s+(-[a-z]*\s+)?-r/i, risk: "critical", reason: "recursive delete" },
  { pattern: /\bsudo\b/i, risk: "high", reason: "elevated privileges" },
  { pattern: /\b(?:dd|mkfs|fdisk|parted)\b/i, risk: "critical", reason: "low-level disk op" },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b/i, risk: "critical", reason: "system shutdown" },
  { pattern: /\bcurl\s.+\|\s*sh\b/i, risk: "critical", reason: "curl-to-shell pattern" },
  { pattern: /\bgit\s+push\s+--force(?:-with-lease)?\s+(?:origin\s+)?(?:main|master)/i, risk: "high", reason: "force push to main" },
  { pattern: /\bgit\s+(?:reset|checkout)\s+(?:--hard|HEAD)/i, risk: "high", reason: "destructive git op" },
  { pattern: /\bnpm\s+publish\b|\bpnpm\s+publish\b|\byarn\s+publish\b/i, risk: "high", reason: "package publish" },
  { pattern: /\bdocker\s+(?:rm|rmi|system\s+prune)/i, risk: "high", reason: "destructive docker op" },
  { pattern: /\b(?:psql|mysql)\b.*\b(?:DROP|TRUNCATE|DELETE)\b/i, risk: "high", reason: "destructive db op" },
];

export function assessCommandRisk(command: string): { risk: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  let risk: RiskLevel = "low";
  for (const def of DANGEROUS_COMMAND_PATTERNS) {
    if (def.pattern.test(command)) {
      reasons.push(def.reason);
      if (riskToInt(def.risk) > riskToInt(risk)) risk = def.risk;
    }
  }
  if (reasons.length === 0) {
    // Read-only commands are safe.
    if (/^\s*(?:ls|pwd|cat|echo|head|tail|grep|wc|which|node\s+-v|npm\s+--version|pnpm\s+--version|git\s+(?:status|log|diff|branch|show))\b/.test(command)) {
      return { risk: "safe", reasons: [] };
    }
  }
  return { risk, reasons };
}
