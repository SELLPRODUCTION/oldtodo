export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'csharp'
  | 'cpp'
  | 'c'
  | 'ruby'
  | 'php'
  | 'html'
  | 'css'
  | 'scss'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'sql'
  | 'shell'
  | 'toml'
  | 'ini'
  | 'unknown';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'method';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  exported: boolean;
}

export type ImportKind = 'internal' | 'package' | 'builtin' | 'unresolved';

export interface ImportRef {
  source: string;
  resolvedPath: string | null;
  kind: ImportKind;
  names: string[];
  line: number;
}

export interface ScannedFile {
  path: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedAt: number;
  hash: string;
  language: Language;
}

export interface FileRecord extends ScannedFile {
  lines: number;
  symbols: CodeSymbol[];
  imports: ImportRef[];
  indexedAt: number;
}

export interface IndexStats {
  totalFiles: number;
  totalLines: number;
  totalSizeBytes: number;
  byLanguage: Record<string, number>;
}

export interface ScanChanges {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
}

export interface IndexSnapshot {
  repoPath: string;
  extractorVersion: number;
  createdAt: number;
  updatedAt: number;
  files: FileRecord[];
  stats: IndexStats;
}

export interface ScanResult {
  snapshot: IndexSnapshot;
  changes: ScanChanges;
}

export interface GraphNode {
  id: string;
  language: Language;
  symbolCount: number;
  inDegree: number;
  outDegree: number;
  isEntryPoint: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  names: string[];
}

export interface ProjectGraphData {
  repoPath: string;
  updatedAt: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  entryPoints: string[];
  entryReasons: Record<string, string[]>;
  externalPackages: Record<string, number>;
  cycles: string[][];
}

export interface EntryPointInfo {
  path: string;
  reasons: string[];
}

export interface ModuleAnalysis {
  path: string;
  found: boolean;
  isEntryPoint: boolean;
  entryReasons: string[];
  inDegree: number;
  outDegree: number;
  imports: { path: string; names: string[] }[];
  importedBy: { path: string; names: string[] }[];
  externalPackages: string[];
  symbols: CodeSymbol[];
  directorySiblings: string[];
}

export type KnowledgeSource = 'scan' | 'ai' | 'user';

export interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  source: KnowledgeSource;
  tags: string[];
  filePaths: string[];
  createdAt: number;
  updatedAt: number;
}

export type MemoryEventType =
  | 'scan'
  | 'question'
  | 'answer'
  | 'model-change'
  | 'knowledge'
  | 'repo-change'
  | 'webhook'
  | 'error'
  | 'system';

export interface MemoryEvent {
  id: string;
  type: MemoryEventType;
  timestamp: number;
  summary: string;
  payload: Record<string, unknown>;
}

export interface TimelineDay {
  date: string;
  events: MemoryEvent[];
}

export interface MemoryData {
  events: MemoryEvent[];
  chat: ChatMessage[];
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelInfo {
  name: string;
  sizeBytes: number;
  family: string;
  parameterSize: string;
  modifiedAt: string;
}

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  numCtx?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  done: boolean;
  totalDurationMs: number;
  tokensGenerated: number;
}

export interface ReadyState {
  available: boolean;
  model: string;
  switched: boolean;
  models: ModelInfo[];
}

export interface FileMatch {
  file: FileRecord;
  score: number;
  reasons: string[];
}

export interface ContentMatch {
  path: string;
  line: number;
  text: string;
}

export interface AskResult {
  answer: string;
  model: string;
  usedFiles: string[];
  sources: string[];
  notFound: boolean;
  blockedReferences: string[];
  durationMs: number;
}

export interface SystemStatus {
  repoPath: string;
  repoExists: boolean;
  indexed: boolean;
  indexStats: IndexStats | null;
  graphNodes: number;
  graphEdges: number;
  entryPoints: number;
  knowledgeEntries: number;
  memoryEvents: number;
  provider: string;
  model: string;
  ollamaAvailable: boolean;
  availableModels: string[];
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  numCtx: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface IndexerConfig {
  maxFileSizeKb: number;
  excludeDirs: string[];
  includeExtensions: string[];
}

export interface ContextConfig {
  maxFiles: number;
  maxCharsPerFile: number;
  maxTotalChars: number;
  chatHistoryTurns: number;
}

export type RuntimeMode = 'local' | 'server';

export interface ServerConfig {
  host: string;
  port: number;
  authToken: string;
  corsOrigin: string;
  githubWebhookSecret: string;
  webhookUserId: string;
}

export interface SellAiConfig {
  mode: RuntimeMode;
  repoPath: string;
  dataDir: string;
  ollama: OllamaConfig;
  indexer: IndexerConfig;
  context: ContextConfig;
  server: ServerConfig;
}