import * as fs from 'fs';
import * as path from 'path';
import { patchConfigFile } from '../config/config';
import {
  IAICore,
  ICodeIndexer,
  IKnowledgeBase,
  ILLMAdapter,
  IMemorySystem,
  IProjectGraph,
} from '../types/contracts';
import {
  AskResult,
  ChatMessage,
  EntryPointInfo,
  FileMatch,
  IndexSnapshot,
  KnowledgeEntry,
  ModuleAnalysis,
  ProjectGraphData,
  ScanResult,
  SellAiConfig,
  SystemStatus,
} from '../types/models';
import { formatDate, truncate } from '../utils/text';
import {
  buildCorrectionMessage,
  extractReferences,
  sanitizeAnswer,
  validateReferences,
} from './answer-validator';
import { buildContext } from './context-builder';
import { retrieve } from './retrieval';

export interface AICoreDeps {
  config: SellAiConfig;
  baseDir: string;
  llm: ILLMAdapter;
  indexer: ICodeIndexer;
  graph: IProjectGraph;
  knowledge: IKnowledgeBase;
  memory: IMemorySystem;
}

const SYSTEM_PROMPT =
  'Ти — SELL AI, локальний асистент розробника проєкту SELLDEV. ' +
  'Відповідай українською мовою, стисло і по суті. ' +
  'Спирайся на наданий контекст кодової бази: файли, символи, граф залежностей і знання про проєкт. ' +
  'Посилайся на конкретні файли та рядки, коли це доречно. ' +
  'Якщо контексту недостатньо — чесно скажи про це і запропонуй, що уточнити або просканувати; не вигадуй код. ' +
  'У прикладах коду не використовуй заглушки та TODO.';

export class AICore implements IAICore {
  constructor(private readonly deps: AICoreDeps) {}

  private activeIndex(): IndexSnapshot | null {
    const index = this.deps.indexer.getIndex();
    if (index && index.repoPath === this.deps.config.repoPath) return index;
    return null;
  }

  private activeGraph(): ProjectGraphData | null {
    const graph = this.deps.graph.getGraph();
    if (graph && graph.repoPath === this.deps.config.repoPath) return graph;
    return null;
  }

  async initialize(): Promise<void> {
    const index = this.deps.indexer.getIndex();
    const graph = this.deps.graph.getGraph();
    if (index && graph && index.repoPath === graph.repoPath) {
      this.deps.graph.attachIndex(index);
    }
    if (index && index.repoPath !== this.deps.config.repoPath) {
      this.deps.memory.record(
        'system',
        'Шлях репозиторію змінився — наявний індекс застарілий, потрібне нове сканування',
        { oldRepo: index.repoPath, newRepo: this.deps.config.repoPath }
      );
    }
    this.deps.memory.record('system', 'SELL AI запущено', {
      model: this.deps.llm.getModel(),
      repoPath: this.deps.config.repoPath,
    });
  }

  async scanRepository(): Promise<ScanResult> {
    const result = await this.deps.indexer.scan();
    const graphData = this.deps.graph.build(result.snapshot);
    const knowledgeCount = this.deps.knowledge.rebuildFromIndex(result.snapshot, graphData);
    this.deps.memory.record(
      'scan',
      `Сканування: +${result.changes.added.length} нових, ~${result.changes.changed.length} змінених, ` +
      `-${result.changes.removed.length} видалених, ${result.changes.unchanged} без змін`,
      {
        added: result.changes.added,
        changed: result.changes.changed,
        removed: result.changes.removed,
        unchanged: result.changes.unchanged,
        totalFiles: result.snapshot.stats.totalFiles,
        entryPoints: graphData.entryPoints.length,
        knowledgeEntries: knowledgeCount,
      }
    );
    return result;
  }

  async ask(question: string, onToken?: (token: string) => void): Promise<AskResult> {
    const startedAt = Date.now();
    this.deps.memory.record('question', question.slice(0, 200), { question });

    const index = this.activeIndex();
    if (!index) {
      return this.notFoundResult(
        question,
        startedAt,
        'Не знайдено. Індекс репозиторію відсутній або застарілий. Виконай scan для поточного репозиторію, потім повтори питання.'
      );
    }

    const retrieval = retrieve(
      question,
      this.deps.indexer,
      this.deps.knowledge,
      this.deps.config.context
    );
    if (!retrieval.confident) {
      return this.notFoundResult(
        question,
        startedAt,
        'Не знайдено. В індексі репозиторію немає файлів чи знань, релевантних до цього питання. Уточни запит або перевір, чи проскановано потрібний репозиторій.'
      );
    }

    const ready = await this.deps.llm.ensureReady();
    if (!ready.available) {
      throw new Error(
        `Ollama недоступна за адресою ${this.deps.config.ollama.baseUrl}. Запусти її командою: ollama serve`
      );
    }

    const context = buildContext(
      retrieval,
      this.deps.indexer,
      this.deps.graph,
      this.deps.config.context
    );
    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
    messages.push(...this.deps.memory.getChatHistory(this.deps.config.context.chatHistoryTurns));
    messages.push({
      role: 'user',
      content: `Контекст кодової бази:\n${context.text}\n\nПитання розробника: ${question}`,
    });

    try {
      let result = onToken
        ? await this.deps.llm.streamChat(messages, onToken)
        : await this.deps.llm.chat(messages);
      let answerText = result.text;
      let blockedReferences: string[] = [];

      const validation = validateReferences(
        extractReferences(answerText),
        question,
        index,
        this.activeGraph()
      );
      if (validation.invalid.length > 0) {
        this.deps.memory.record(
          'system',
          `Валідатор джерел виявив неіснуючі посилання: ${validation.invalid.join(', ')}`,
          { invalid: validation.invalid }
        );
        onToken?.(
          '\n\n[Перевірка джерел: виявлено неіснуючі файли/модулі — генерую виправлену відповідь]\n\n'
        );
        const retryMessages: ChatMessage[] = [
          ...messages,
          { role: 'assistant', content: answerText },
          { role: 'user', content: buildCorrectionMessage(validation.invalid, index) },
        ];
        result = await this.deps.llm.chat(retryMessages);
        answerText = result.text;
        const revalidation = validateReferences(
          extractReferences(answerText),
          question,
          index,
          this.activeGraph()
        );
        if (revalidation.invalid.length > 0) {
          answerText = sanitizeAnswer(answerText, revalidation.invalid);
          blockedReferences = revalidation.invalid;
        }
        onToken?.(answerText);
      }

      const fileSet = new Set(index.files.map((f) => f.path));
      const sources = [
        ...new Set([
          ...retrieval.files.map((f) => f.path),
          ...retrieval.knowledge.flatMap((k) => k.filePaths),
        ]),
      ].filter((p) => fileSet.has(p));

      this.deps.memory.record(
        'answer',
        `Відповідь: ${answerText.length} символів, модель ${result.model}, ` +
        `джерел: ${sources.length}, заблоковано посилань: ${blockedReferences.length}`,
        { sources, model: result.model, blockedReferences, tokens: result.tokensGenerated }
      );
      this.deps.memory.appendChatTurn(question, answerText);
      return {
        answer: answerText,
        model: result.model,
        usedFiles: retrieval.files.map((f) => f.path),
        sources,
        notFound: false,
        blockedReferences,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.memory.record('error', `Помилка генерації відповіді: ${message.slice(0, 300)}`);
      throw err;
    }
  }

  private notFoundResult(question: string, startedAt: number, message: string): AskResult {
    this.deps.memory.record('answer', message, { notFound: true });
    this.deps.memory.appendChatTurn(question, message);
    return {
      answer: message,
      model: this.deps.llm.getModel(),
      usedFiles: [],
      sources: [],
      notFound: true,
      blockedReferences: [],
      durationMs: Date.now() - startedAt,
    };
  }

  findFiles(query: string, limit = 10): FileMatch[] {
    if (!this.activeIndex()) return [];
    return this.deps.indexer.findFiles(query, limit);
  }

  getEntryPoints(): EntryPointInfo[] {
    if (!this.activeGraph()) return [];
    return this.deps.graph.getEntryPoints();
  }

  analyzeRelations(relPath: string): ModuleAnalysis {
    if (!this.activeGraph()) {
      return {
        path: relPath,
        found: false,
        isEntryPoint: false,
        entryReasons: [],
        inDegree: 0,
        outDegree: 0,
        imports: [],
        importedBy: [],
        externalPackages: [],
        symbols: [],
        directorySiblings: [],
      };
    }
    return this.deps.graph.analyzeModule(relPath);
  }

  async summarizeFile(relPath: string): Promise<KnowledgeEntry> {
    const normalized = relPath.split('\\').join('/').replace(/^\.\//, '');
    const content = this.deps.indexer.readFile(normalized);
    if (content === null) {
      throw new Error(
        `Файл "${normalized}" не знайдено в індексі. Виконай scan або перевір шлях командою find.`
      );
    }
    const ready = await this.deps.llm.ensureReady();
    if (!ready.available) {
      throw new Error('Ollama недоступна. Запусти її командою: ollama serve');
    }
    const analysis = this.deps.graph.analyzeModule(normalized);
    const symbolList = analysis.symbols
      .map((s) => `${s.kind} ${s.name} (рядок ${s.line})`)
      .join(', ');
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Створи стислий технічний опис файлу "${normalized}" для бази знань проєкту: ` +
          `призначення, ключові символи, зв'язки з іншими модулями.\n\n` +
          `Символи: ${symbolList || 'немає'}.\n` +
          `Імпортує: ${analysis.imports.map((i) => i.path).join(', ') || '—'}.\n` +
          `Імпортується в: ${analysis.importedBy.map((i) => i.path).join(', ') || '—'}.\n\n` +
          `Вміст файлу:\n\`\`\`\n${truncate(content, 12000)}\n\`\`\``,
      },
    ];
    const result = await this.deps.llm.chat(messages, { maxTokens: 1024 });
    const entry = this.deps.knowledge.add(
      `Файл: ${normalized}`,
      result.text,
      'ai',
      ['ai', 'файл', normalized],
      [normalized]
    );
    this.deps.memory.record('knowledge', `AI-опис файлу ${normalized}`, {
      entryId: entry.id,
      model: result.model,
    });
    return entry;
  }

  addNote(text: string): KnowledgeEntry {
    const entry = this.deps.knowledge.add(
      `Нотатка від ${formatDate(Date.now())}`,
      text,
      'user',
      ['нотатка']
    );
    this.deps.memory.record('knowledge', `Нотатку користувача збережено: ${text.slice(0, 120)}`, {
      entryId: entry.id,
    });
    return entry;
  }

  async status(): Promise<SystemStatus> {
    const index = this.activeIndex();
    const graph = this.activeGraph();
    let ollamaAvailable = false;
    let availableModels: string[] = [];
    try {
      ollamaAvailable = await this.deps.llm.getProvider().isAvailable();
      if (ollamaAvailable) {
        availableModels = (await this.deps.llm.listModels()).map((m) => m.name);
      }
    } catch {
      ollamaAvailable = false;
    }
    return {
      repoPath: this.deps.config.repoPath,
      repoExists: fs.existsSync(this.deps.config.repoPath),
      indexed: index !== null,
      indexStats: index?.stats ?? null,
      graphNodes: graph?.nodes.length ?? 0,
      graphEdges: graph?.edges.length ?? 0,
      entryPoints: graph?.entryPoints.length ?? 0,
      knowledgeEntries: this.deps.knowledge.all().length,
      memoryEvents: this.deps.memory.getEvents(Number.MAX_SAFE_INTEGER).length,
      provider: this.deps.llm.getProvider().name,
      model: this.deps.llm.getModel(),
      ollamaAvailable,
      availableModels,
    };
  }

  setRepoPath(newPath: string): void {
    const resolved = path.resolve(this.deps.baseDir, newPath);
    const old = this.deps.config.repoPath;
    this.deps.config.repoPath = resolved;
    patchConfigFile(this.deps.baseDir, { repoPath: resolved });
    this.deps.memory.record('repo-change', `Репозиторій змінено: ${old} → ${resolved}`, {
      old,
      new: resolved,
    });
  }
}