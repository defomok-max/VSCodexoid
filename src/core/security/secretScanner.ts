import type { SecretMatch } from "../tools/toolTypes";

/**
 * Heuristic secret scanner. Detects high-confidence patterns (API keys, JWTs,
 * private keys, AWS access keys, etc.) and returns the same content with each
 * match replaced by a placeholder.
 *
 * This is intentionally conservative — false negatives are preferred over
 * false positives. The agent layer adds a stricter scan for any content that
 * actually leaves the box (provider request bodies).
 */
export interface ScannerResult {
  redacted: string;
  matches: SecretMatch[];
}

export function scanSecrets(content: string): ScannerResult {
  const matches: SecretMatch[] = [];
  let redacted = content;

  for (const def of PATTERNS) {
    const regex = new RegExp(def.regex.source, def.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content))) {
      matches.push({
        type: def.type,
        start: m.index,
        end: m.index + m[0].length,
        preview: maskPreview(m[0]),
      });
    }
  }

  matches.sort((a, b) => a.start - b.start);
  // Apply replacements right-to-left so indices stay valid.
  for (const m of [...matches].sort((a, b) => b.start - a.start)) {
    redacted = redacted.slice(0, m.start) + `[REDACTED:${m.type}]` + redacted.slice(m.end);
  }

  return { redacted, matches };
}

function maskPreview(s: string): string {
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

interface PatternDef {
  type: string;
  regex: RegExp;
}

const PATTERNS: PatternDef[] = [
  { type: "openai", regex: /\bsk-[A-Za-z0-9_-]{32,}\b/g },
  { type: "anthropic", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { type: "github-pat", regex: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { type: "github-fine-grained-pat", regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { type: "github-oauth", regex: /\bgho_[A-Za-z0-9]{30,}\b/g },
  { type: "github-app-token", regex: /\bghs_[A-Za-z0-9]{30,}\b/g },
  { type: "google-api", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: "aws-access-key-id", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "aws-secret-access-key", regex: /\b[A-Za-z0-9/+=]{40}\b(?=[^A-Za-z0-9/+=]|$)/g },
  { type: "slack-bot-token", regex: /\bxox[abp]-[A-Za-z0-9-]{10,}\b/g },
  { type: "stripe-secret", regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { type: "generic-bearer", regex: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
  { type: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    type: "private-key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  { type: "azure-storage", regex: /\bDefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[^;]+/g },
  { type: "discord-bot", regex: /\b[MNO][A-Za-z\d]{23,28}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}\b/g },
  { type: "telegram-bot", regex: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g },
];
