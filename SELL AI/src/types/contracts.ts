import {
  AskResult,
  ChatMessage,
  ContentMatch,
  FileMatch,
  GenerateOptions,
  GenerateResult,
  GraphEdge,
  IndexSnapshot,
  KnowledgeEntry,
  KnowledgeSource,
  MemoryEvent,
  MemoryEventType,
  ModelInfo,
  ModuleAnalysis,
  EntryPointInfo,
  ProjectGraphData,
  ReadyState,
  ScanResult,
  SystemStatus,
  TimelineDay,
} from './models';

export interface IModelProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
  chat(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult>;
  streamChat(
    messages: ChatMessage[],
    options: GenerateOptions | undefined,
    onToken: (token: string) => void
  ): Promise<GenerateResult>;
}

export interface ILLMAdapter {
  getProvider(): IModelProvider;
  getModel(): string;
  setModel(model: string): void;
  ensureReady(): Promise<ReadyState>;
  listModels(): Promise<ModelInfo[]>;
  chat(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult>;
  streamChat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: GenerateOptions
  ): Promise<GenerateResult>;
}

export interface ICodeIndexer {
  scan(): Promise<ScanResult>;
  getIndex(): IndexSnapshot | null;
  findFiles(query: string, limit?: number): FileMatch[];
  searchContent(query: string, limit?: number): ContentMatch[];
  readFile(relPath: string): string | null;
}

export interface IProjectGraph {
  build(index: IndexSnapshot): ProjectGraphData;
  attachIndex(index: IndexSnapshot): void;
  getGraph(): ProjectGraphData | null;
  getEntryPoints(): EntryPointInfo[];
  getNeighbors(relPath: string, direction: 'in' | 'out' | 'both'): GraphEdge[];
  findPath(from: string, to: string): string[] | null;
  analyzeModule(relPath: string): ModuleAnalysis;
}

export interface IKnowledgeBase {
  add(
    topic: string,
    content: string,
    source: KnowledgeSource,
    tags?: string[],
    filePaths?: string[]
  ): KnowledgeEntry;
  update(id: string, content: string): KnowledgeEntry | null;
  remove(id: string): boolean;
  get(id: string): KnowledgeEntry | null;
  all(): KnowledgeEntry[];
  search(query: string, limit?: number): KnowledgeEntry[];
  rebuildFromIndex(index: IndexSnapshot, graph: ProjectGraphData): number;
}

export interface IMemorySystem {
  record(
    type: MemoryEventType,
    summary: string,
    payload?: Record<string, unknown>
  ): MemoryEvent;
  getEvents(limit?: number, type?: MemoryEventType): MemoryEvent[];
  getTimeline(): TimelineDay[];
  appendChatTurn(question: string, answer: string): void;
  getChatHistory(turns?: number): ChatMessage[];
  clearChat(): void;
}

export interface IAICore {
  initialize(): Promise<void>;
  scanRepository(): Promise<ScanResult>;
  ask(question: string, onToken?: (token: string) => void): Promise<AskResult>;
  findFiles(query: string, limit?: number): FileMatch[];
  getEntryPoints(): EntryPointInfo[];
  analyzeRelations(relPath: string): ModuleAnalysis;
  summarizeFile(relPath: string): Promise<KnowledgeEntry>;
  addNote(text: string): KnowledgeEntry;
  status(): Promise<SystemStatus>;
  setRepoPath(newPath: string): void;
}