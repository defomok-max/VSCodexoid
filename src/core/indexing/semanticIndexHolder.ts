import * as path from "node:path";
import { buildEmbeddingsProvider } from "../providers/embeddingsAdapters";
import type { ProviderProfile } from "../../shared/types";
import { SemanticIndex, type SemanticIndexBuildStats } from "./semanticIndex";
import type { IndexBridge } from "./workspaceIndex";

export interface SemanticIndexHolderOptions {
  workspaceRoot: string;
  bridge: IndexBridge;
  /** Reads the current `nexus.*` settings on demand. */
  readSettings: () => SemanticHolderSettings;
  resolveProfile: (profileId: string) => ProviderProfile | undefined;
  resolveApiKey: (profileId: string) => Promise<string | undefined>;
  /** Directory for persisted vector snapshots. */
  storageDir: string;
  log?: (msg: string) => void;
}

export interface SemanticHolderSettings {
  enabled: boolean;
  embeddingProvider: string;
  defaultProvider: string;
  embeddingModel: string;
  embeddingDimensions: number | undefined;
  embeddingMaxChunkChars: number;
}

export interface SemanticHolderStats {
  ready: boolean;
  files: number;
  chunks: number;
  providerId: string | undefined;
  model: string | undefined;
  dimensions: number | undefined;
  reason?: string;
}

/**
 * Owns the lifecycle of an optional `SemanticIndex` for the active workspace.
 *
 * The semantic index is enabled by `nexus.enableSemanticIndex` and requires
 * an embeddings provider profile. The holder is intentionally lazy:
 *   - It does not build an index until something asks for one (search / refresh).
 *   - When settings change (provider, model, dimensions), a stale index is
 *     dropped and the next call rebuilds.
 *   - When the feature is disabled, all calls return a "not available" error
 *     so the agent can produce a clear message instead of a vague stack trace.
 */
export class SemanticIndexHolder {
  private current: SemanticIndex | undefined;
  private signature = "";

  constructor(private readonly opts: SemanticIndexHolderOptions) {}

  /** Reset cached state (e.g. after settings changed). */
  invalidate(): void {
    this.current = undefined;
    this.signature = "";
  }

  available(): { ok: true } | { ok: false; reason: string } {
    const s = this.opts.readSettings();
    if (!s.enabled) return { ok: false, reason: "nexus.enableSemanticIndex is off" };
    const profileId = s.embeddingProvider || s.defaultProvider;
    if (!profileId) return { ok: false, reason: "no provider id (nexus.embeddingProvider/defaultProvider)" };
    const profile = this.opts.resolveProfile(profileId);
    if (!profile) return { ok: false, reason: `unknown provider profile '${profileId}'` };
    if (!s.embeddingModel) return { ok: false, reason: "nexus.embeddingModel is empty" };
    return { ok: true };
  }

  async stats(): Promise<SemanticHolderStats> {
    const avail = this.available();
    if (!avail.ok) return emptyStats(avail.reason);
    const idx = await this.ensure();
    return {
      ready: idx.ready(),
      files: idx.filesIndexed(),
      chunks: idx.size(),
      providerId: this.signatureProviderId(),
      model: this.signatureModel(),
      dimensions: this.signatureDimensions(),
    };
  }

  async search(
    query: string,
    opts: { k?: number; filePattern?: string; signal?: AbortSignal } = {},
  ): Promise<
    | { ok: true; hits: import("./semanticIndex").SemanticIndexSearchHit[] }
    | { ok: false; reason: string }
  > {
    const avail = this.available();
    if (!avail.ok) return avail;
    const idx = await this.ensure();
    if (idx.size() === 0) {
      return { ok: false, reason: "semantic index is empty — run 'refresh_semantic_index' first" };
    }
    const hits = await idx.search(query, opts);
    return { ok: true, hits };
  }

  async refresh(opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<
    | { ok: true; stats: SemanticIndexBuildStats }
    | { ok: false; reason: string }
  > {
    const avail = this.available();
    if (!avail.ok) return avail;
    const idx = await this.ensure();
    const stats = await idx.refresh(opts);
    return { ok: true, stats };
  }

  /** Build (or rebuild) the underlying SemanticIndex when the signature changes. */
  private async ensure(): Promise<SemanticIndex> {
    const s = this.opts.readSettings();
    const profileId = s.embeddingProvider || s.defaultProvider;
    const profile = this.opts.resolveProfile(profileId);
    if (!profile) {
      throw new Error(`unknown provider profile '${profileId}'`);
    }
    const sig = JSON.stringify({
      profileId: profile.id,
      type: profile.type,
      baseUrl: profile.baseUrl ?? "",
      model: s.embeddingModel,
      dimensions: s.embeddingDimensions ?? null,
      maxChunkChars: s.embeddingMaxChunkChars,
    });
    if (this.current && sig === this.signature) return this.current;
    const apiKey = await this.opts.resolveApiKey(profile.id);
    const embeddings = buildEmbeddingsProvider({
      profile,
      model: s.embeddingModel,
      dimensions: s.embeddingDimensions,
    });
    this.current = new SemanticIndex({
      root: this.opts.workspaceRoot,
      bridge: this.opts.bridge,
      embeddings,
      apiKey,
      snapshotPath: path.join(this.opts.storageDir, snapshotFileName(this.opts.workspaceRoot, profile.id, s.embeddingModel)),
      chunker: { maxChars: s.embeddingMaxChunkChars },
      log: this.opts.log,
    });
    this.signature = sig;
    return this.current;
  }

  private signatureProviderId(): string | undefined {
    if (!this.signature) return undefined;
    try {
      return (JSON.parse(this.signature) as { profileId?: string }).profileId;
    } catch {
      return undefined;
    }
  }
  private signatureModel(): string | undefined {
    if (!this.signature) return undefined;
    try {
      return (JSON.parse(this.signature) as { model?: string }).model;
    } catch {
      return undefined;
    }
  }
  private signatureDimensions(): number | undefined {
    if (!this.signature) return undefined;
    try {
      const v = (JSON.parse(this.signature) as { dimensions?: number | null }).dimensions;
      return typeof v === "number" ? v : undefined;
    } catch {
      return undefined;
    }
  }
}

function emptyStats(reason: string): SemanticHolderStats {
  return {
    ready: false,
    files: 0,
    chunks: 0,
    providerId: undefined,
    model: undefined,
    dimensions: undefined,
    reason,
  };
}

function snapshotFileName(root: string, providerId: string, model: string): string {
  const slug = `${providerId}__${model}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  const wsHash = djb2(root);
  return `semantic-${wsHash}-${slug}.json`;
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(36);
}
