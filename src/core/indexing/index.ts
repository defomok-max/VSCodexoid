export { WorkspaceIndex } from "./workspaceIndex";
export type { WorkspaceIndexStats, SymbolHit, FileEntry, IndexBridge } from "./workspaceIndex";
export { extractSymbols, isSupportedForSymbols } from "./symbolExtractor";
export type { SymbolEntry, SymbolKind } from "./symbolExtractor";
export { InvertedIndex, tokenize } from "./lexicalSearch";
export type { SearchHit } from "./lexicalSearch";
export { chunkFile } from "./chunker";
export type { FileChunk, ChunkerOptions } from "./chunker";
export { VectorStore, VECTOR_STORE_SCHEMA_VERSION, hashChunkContent } from "./vectorStore";
export type {
  VectorChunk,
  VectorSearchHit,
  VectorStoreOptions,
  VectorStoreSnapshot,
} from "./vectorStore";
export { SemanticIndex } from "./semanticIndex";
export type {
  SemanticIndexBuildStats,
  SemanticIndexOptions,
  SemanticIndexRefreshOptions,
  SemanticIndexSearchHit,
  SemanticIndexSearchOptions,
} from "./semanticIndex";
export { SemanticIndexHolder } from "./semanticIndexHolder";
export type {
  SemanticHolderSettings,
  SemanticHolderStats,
  SemanticIndexHolderOptions,
} from "./semanticIndexHolder";
