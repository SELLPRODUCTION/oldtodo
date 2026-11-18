import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { patchConfigFile } from '../config/config';
import { AICore, AICoreDeps } from '../ai-core/ai-core';
import { formatDate, formatBytes, truncate } from '../utils/text';

const HELP_TEXT = `Команди SELL AI:
  scan                  — просканувати та проіндексувати репозиторій
  ask <питання>         — питання про кодову базу (або просто введи питання без команди)
  find <запит>          — знайти файли за назвою та символами
  grep <текст>          — пошук тексту у вмісті файлів
  entry                 — точки входу проєкту
  graph [файл]          — огляд графа залежностей або сусіди файла
  relate <файл>         — повний аналіз зв'язків модуля
  path <від> <до>       — ланцюжок залежностей між двома файлами
  summarize <файл>      — AI-опис файлу в базу знань
  knowledge [запит]     — база знань: усі записи або пошук
  note <текст>          — зберегти нотатку в базу знань
  history [n]           — останні n подій пам'яті (за замовчуванням 20)
  timeline              — історія розвитку проєкту по днях
  models                — список моделей Ollama
  model [назва]         — поточна модель або перемикання на іншу
  repo [шлях]           — поточний репозиторій або зміна шляху до SELLDEV
  status                — стан усієї системи
  clear                 — очистити історію чату
  help                  — ця довідка
  exit                  — вихід`;

export class CLI {
  private rl: readline.Interface | null = null;
  private busy = false;
  private readonly queue: string[] = [];

  constructor(
    private readonly deps: AICoreDeps,
    private readonly core: AICore
  ) {}

  private print(text: string): void {
    process.stdout.write(`${text}\n`);
  }

  async runOnce(args: string[]): Promise<void> {
    const line = args.join(' ').trim();
    if (!line) return;
    try {
      await this.handle(line);
    } catch (err) {
      this.print(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  runInteractive(): void {
    const { config } = this.deps;
    const repoExists = fs.existsSync(config.repoPath);
    this.print('SELL AI — локальна AI-підсистема SELLDEV');
    this.print(`Репозиторій: ${config.repoPath}${repoExists ? '' : ' [НЕ ЗНАЙДЕНО — вкажи шлях командою repo]'}`);
    this.print(`Модель: ${config.ollama.model} | Ollama: ${config.ollama.baseUrl}`);
    this.print(`Дані: ${config.dataDir}`);
    if (!this.deps.indexer.getIndex()) {
      this.print('Індекс відсутній — почни з команди scan.');
    }
    this.print('Введи help для списку команд або одразу постав питання.');
    this.print('');

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'sell-ai> ',
    });
    this.rl.prompt();
    this.rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl?.prompt();
        return;
      }
      if (this.busy) {
        this.queue.push(trimmed);
        return;
      }
      void this.process(trimmed);
    });
    this.rl.on('SIGINT', () => {
      this.print('\nПереривання не підтримується під час генерації. Введи exit для виходу.');
      this.rl?.prompt();
    });
    this.rl.on('close', () => {
      this.print('Бувай!');
      process.exit(0);
    });
  }

  private async process(line: string): Promise<void> {
    this.busy = true;
    try {
      await this.handle(line);
    } catch (err) {
      this.print(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.busy = false;
    }
    const next = this.queue.shift();
    if (next !== undefined) {
      void this.process(next);
    } else {
      this.rl?.prompt();
    }
  }

  private async handle(line: string): Promise<void> {
    const spaceIndex = line.search(/\s/);
    const command = (spaceIndex === -1 ? line : line.slice(0, spaceIndex)).toLowerCase();
    const arg = spaceIndex === -1 ? '' : line.slice(spaceIndex + 1).trim();

    switch (command) {
      case 'help':
      case 'допомога':
        this.print(HELP_TEXT);
        return;
      case 'exit':
      case 'quit':
      case 'вихід':
        if (this.rl) {
          this.rl.close();
        }
        return;
      case 'scan':
      case 'скан':
      case 'сканувати':
        await this.cmdScan();
        return;
      case 'status':
      case 'статус':
        await this.cmdStatus();
        return;
      case 'models':
      case 'моделі':
        await this.cmdModels();
        return;
      case 'model':
      case 'модель':
        await this.cmdModel(arg);
        return;
      case 'repo':
      case 'репо':
        this.cmdRepo(arg);
        return;
      case 'find':
      case 'знайти':
        this.cmdFind(arg);
        return;
      case 'grep':
      case 'пошук':
        this.cmdGrep(arg);
        return;
      case 'entry':
      case 'вхід':
      case 'точки':
        this.cmdEntry();
        return;
      case 'graph':
      case 'граф':
        this.cmdGraph(arg);
        return;
      case 'relate':
      case "зв'язки":
      case 'звʼязки':
      case 'зв`язки':
      case 'analyze':
        this.cmdRelate(arg);
        return;
      case 'path':
      case 'шлях':
        this.cmdPath(arg);
        return;
      case 'summarize':
      case 'підсумок':
        await this.cmdSummarize(arg);
        return;
      case 'knowledge':
      case 'знання':
        this.cmdKnowledge(arg);
        return;
      case 'note':
      case 'нотатка':
        this.cmdNote(arg);
        return;
      case 'history':
      case 'історія':
        this.cmdHistory(arg);
        return;
      case 'timeline':
      case 'таймлайн':
        this.cmdTimeline();
        return;
      case 'clear':
      case 'очистити':
        this.deps.memory.clearChat();
        this.print('Історію чату очищено.');
        return;
      case 'ask':
      case 'питання':
      case 'запитати':
        await this.cmdAsk(arg);
        return;
      default:
        await this.cmdAsk(line);
    }
  }

  private async cmdScan(): Promise<void> {
    this.print(`Сканування репозиторію: ${this.deps.config.repoPath} …`);
    const startedAt = Date.now();
    const { snapshot, changes } = await this.core.scanRepository();
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    this.print(
      `Готово за ${seconds} с. Файлів: ${snapshot.stats.totalFiles}, рядків: ${snapshot.stats.totalLines}, ` +
      `розмір: ${formatBytes(snapshot.stats.totalSizeBytes)}.`
    );
    this.print(
      `Зміни: +${changes.added.length} нових, ~${changes.changed.length} змінених, ` +
      `-${changes.removed.length} видалених, ${changes.unchanged} без змін.`
    );
    const showList = (label: string, items: string[]): void => {
      if (items.length === 0) return;
      this.print(`${label}:`);
      for (const item of items.slice(0, 15)) this.print(`  ${item}`);
      if (items.length > 15) this.print(`  … ще ${items.length - 15}`);
    };
    showList('Нові', changes.added);
    showList('Змінені', changes.changed);
    showList('Видалені', changes.removed);
    const graph = this.deps.graph.getGraph();
    if (graph) {
      this.print(
        `Граф: ${graph.nodes.length} вузлів, ${graph.edges.length} ребер, ` +
        `${graph.entryPoints.length} точок входу, циклів: ${graph.cycles.length}.`
      );
    }
    this.print('Базу знань оновлено. Можна ставити питання.');
  }

  private async cmdStatus(): Promise<void> {
    const status = await this.core.status();
    this.print(`Репозиторій: ${status.repoPath}${status.repoExists ? '' : ' [НЕ ЗНАЙДЕНО]'}`);
    this.print(`Провайдер: ${status.provider} | Модель: ${status.model}`);
    this.print(`Ollama: ${status.ollamaAvailable ? 'доступна' : 'НЕДОСТУПНА (запусти: ollama serve)'}`);
    if (status.availableModels.length > 0) {
      this.print(`Моделі в Ollama: ${status.availableModels.join(', ')}`);
    }
    if (status.indexed && status.indexStats) {
      this.print(
        `Індекс: ${status.indexStats.totalFiles} файлів, ${status.indexStats.totalLines} рядків, ` +
        `${formatBytes(status.indexStats.totalSizeBytes)}`
      );
      const languages = Object.entries(status.indexStats.byLanguage)
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => `${lang}=${count}`)
        .join(', ');
      this.print(`Мови: ${languages}`);
    } else {
      this.print('Індекс: відсутній або застарілий (виконай scan)');
    }
    this.print(
      `Граф: ${status.graphNodes} вузлів, ${status.graphEdges} ребер, ${status.entryPoints} точок входу`
    );
    this.print(`База знань: ${status.knowledgeEntries} записів`);
    this.print(`Пам'ять: ${status.memoryEvents} подій`);
  }

  private async cmdModels(): Promise<void> {
    const models = await this.deps.llm.listModels();
    if (models.length === 0) {
      this.print('Моделей немає. Встанови, наприклад: ollama pull qwen2.5:7b');
      return;
    }
    const current = this.deps.llm.getModel();
    this.print('Моделі Ollama:');
    for (const model of models) {
      const marker = model.name === current ? ' (поточна)' : '';
      this.print(
        `  ${model.name}${marker} — ${formatBytes(model.sizeBytes)}, ` +
        `${model.family || '—'} ${model.parameterSize || ''}`.trimEnd()
      );
    }
  }

  private async cmdModel(arg: string): Promise<void> {
    if (!arg) {
      this.print(`Поточна модель: ${this.deps.llm.getModel()}`);
      return;
    }
    const previous = this.deps.llm.getModel();
    this.deps.llm.setModel(arg);
    patchConfigFile(this.deps.baseDir, { model: arg });
    this.deps.memory.record('model-change', `Модель перемкнено вручну: ${previous} → ${arg}`, {
      from: previous,
      to: arg,
    });
    const ready = await this.deps.llm.ensureReady();
    if (!ready.available) {
      this.print(`Модель встановлено: ${arg}, але Ollama недоступна. Перевірка відбудеться при першому запиті.`);
      return;
    }
    this.print(`Поточна модель: ${ready.model}`);
  }

  private cmdRepo(arg: string): void {
    if (!arg) {
      this.print(`Поточний репозиторій: ${this.deps.config.repoPath}`);
      return;
    }
    const resolved = path.resolve(process.cwd(), arg);
    if (!fs.existsSync(resolved)) {
      this.print(`Увага: шлях "${resolved}" не існує. Все одно зберігаю в конфігурацію.`);
    }
    this.core.setRepoPath(resolved);
    this.print(`Репозиторій змінено: ${resolved}. Виконай scan для індексації.`);
  }

  private cmdFind(arg: string): void {
    if (!arg) {
      this.print('Вкажи запит: find <назва або символ>');
      return;
    }
    const matches = this.core.findFiles(arg, 10);
    if (matches.length === 0) {
      this.print('Нічого не знайдено. Перевір, чи виконано scan для поточного репозиторію.');
      return;
    }
    this.print(`Знайдено файлів: ${matches.length}`);
    for (const match of matches) {
      this.print(`  ${match.file.path} (релевантність ${match.score.toFixed(1)})`);
      for (const reason of match.reasons) this.print(`    — ${reason}`);
    }
  }

  private cmdGrep(arg: string): void {
    if (!arg) {
      this.print('Вкажи текст: grep <фрагмент коду>');
      return;
    }
    const matches = this.deps.indexer.searchContent(arg, 40);
    if (matches.length === 0) {
      this.print('Текст не знайдено в проіндексованих файлах.');
      return;
    }
    for (const match of matches) {
      this.print(`  ${match.path}:${match.line}: ${match.text}`);
    }
  }

  private cmdEntry(): void {
    const entries = this.core.getEntryPoints();
    if (entries.length === 0) {
      this.print('Точок входу не знайдено. Виконай scan.');
      return;
    }
    this.print(`Точки входу проєкту (${entries.length}):`);
    for (const entry of entries) {
      this.print(`  ${entry.path}`);
      for (const reason of entry.reasons) this.print(`    — ${reason}`);
    }
  }

  private cmdGraph(arg: string): void {
    const graph = this.deps.graph.getGraph();
    if (!graph) {
      this.print('Граф відсутній. Виконай scan.');
      return;
    }
    if (arg) {
      const out = this.deps.graph.getNeighbors(arg, 'out');
      const incoming = this.deps.graph.getNeighbors(arg, 'in');
      this.print(`Файл: ${arg}`);
      this.print(`Імпортує (${out.length}):`);
      for (const edge of out) {
        this.print(`  → ${edge.to}${edge.names.length > 0 ? ` [${edge.names.join(', ')}]` : ''}`);
      }
      this.print(`Імпортується в (${incoming.length}):`);
      for (const edge of incoming) {
        this.print(`  ← ${edge.from}${edge.names.length > 0 ? ` [${edge.names.join(', ')}]` : ''}`);
      }
      return;
    }
    this.print(`Граф залежностей: ${graph.nodes.length} вузлів, ${graph.edges.length} ребер.`);
    this.print(`Точок входу: ${graph.entryPoints.length} (команда entry).`);
    const packages = Object.entries(graph.externalPackages).sort((a, b) => b[1] - a[1]);
    if (packages.length > 0) {
      this.print('Зовнішні пакети:');
      for (const [pkg, count] of packages.slice(0, 10)) {
        this.print(`  ${pkg}: ${count} імпорт(ів)`);
      }
    }
    if (graph.cycles.length > 0) {
      this.print(`Циклічні залежності (${graph.cycles.length}):`);
      for (const cycle of graph.cycles.slice(0, 5)) {
        this.print(`  ${cycle.join(' → ')}`);
      }
    }
  }

  private cmdRelate(arg: string): void {
    if (!arg) {
      this.print('Вкажи файл: relate <шлях/до/файлу>');
      return;
    }
    const analysis = this.core.analyzeRelations(arg);
    if (!analysis.found) {
      this.print(`Файл "${arg}" не знайдено в графі. Перевір шлях командою find.`);
      return;
    }
    this.print(`Аналіз модуля: ${analysis.path}`);
    this.print(
      `Точка входу: ${analysis.isEntryPoint ? `так (${analysis.entryReasons.join('; ')})` : 'ні'}`
    );
    this.print(`Вхідних зв'язків: ${analysis.inDegree}, вихідних: ${analysis.outDegree}`);
    this.print(`Імпортує (${analysis.imports.length}):`);
    for (const imp of analysis.imports) {
      this.print(`  → ${imp.path}${imp.names.length > 0 ? ` [${imp.names.join(', ')}]` : ''}`);
    }
    this.print(`Імпортується в (${analysis.importedBy.length}):`);
    for (const imp of analysis.importedBy) {
      this.print(`  ← ${imp.path}${imp.names.length > 0 ? ` [${imp.names.join(', ')}]` : ''}`);
    }
    if (analysis.externalPackages.length > 0) {
      this.print(`Зовнішні пакети: ${analysis.externalPackages.join(', ')}`);
    }
    if (analysis.symbols.length > 0) {
      this.print('Символи:');
      for (const symbol of analysis.symbols.slice(0, 20)) {
        this.print(`  ${symbol.kind} ${symbol.name} (рядок ${symbol.line})${symbol.exported ? ' [export]' : ''}`);
      }
    }
    if (analysis.directorySiblings.length > 0) {
      this.print(`Сусідні файли в директорії: ${analysis.directorySiblings.join(', ')}`);
    }
  }

  private cmdPath(arg: string): void {
    const parts = arg.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      this.print('Вкажи два файли: path <від> <до>');
      return;
    }
    const chain = this.deps.graph.findPath(parts[0], parts[1]);
    if (!chain) {
      this.print('Ланцюжок залежностей не знайдено (перевір шляхи та виконай scan).');
      return;
    }
    this.print(chain.join(' → '));
  }

  private async cmdSummarize(arg: string): Promise<void> {
    if (!arg) {
      this.print('Вкажи файл: summarize <шлях/до/файлу>');
      return;
    }
    this.print(`Генерую AI-опис файлу ${arg} …`);
    const entry = await this.core.summarizeFile(arg);
    this.print(`Збережено в базу знань: ${entry.id}`);
    this.print(entry.content);
  }

  private cmdKnowledge(arg: string): void {
    const entries = arg
      ? this.deps.knowledge.search(arg, 8)
      : this.deps.knowledge.all();
    if (entries.length === 0) {
      this.print(arg ? 'Нічого не знайдено в базі знань.' : 'База знань порожня. Виконай scan.');
      return;
    }
    this.print(`Записів: ${entries.length}`);
    for (const entry of entries) {
      this.print(`\n[${entry.source}] ${entry.topic} (оновлено ${formatDate(entry.updatedAt)})`);
      this.print(truncate(entry.content, 400));
    }
  }

  private cmdNote(arg: string): void {
    if (!arg) {
      this.print('Вкажи текст нотатки: note <текст>');
      return;
    }
    const entry = this.core.addNote(arg);
    this.print(`Нотатку збережено: ${entry.id}`);
  }

  private cmdHistory(arg: string): void {
    const limit = Number.parseInt(arg, 10);
    const events = this.deps.memory.getEvents(Number.isNaN(limit) ? 20 : limit);
    if (events.length === 0) {
      this.print('Пам\'ять порожня.');
      return;
    }
    for (const event of events) {
      this.print(`  ${formatDate(event.timestamp)} [${event.type}] ${event.summary}`);
    }
  }

  private cmdTimeline(): void {
    const days = this.deps.memory.getTimeline();
    if (days.length === 0) {
      this.print('Історія розвитку порожня.');
      return;
    }
    this.print('Історія розвитку проєкту:');
    for (const day of days.slice(0, 14)) {
      const scans = day.events.filter((e) => e.type === 'scan');
      const questions = day.events.filter((e) => e.type === 'question');
      const knowledge = day.events.filter((e) => e.type === 'knowledge');
      const modelChanges = day.events.filter((e) => e.type === 'model-change');
      this.print(
        `\n${day.date}: подій ${day.events.length} | сканувань ${scans.length} | ` +
        `питань ${questions.length} | знань ${knowledge.length} | змін моделі ${modelChanges.length}`
      );
      for (const event of day.events) {
        if (['scan', 'question', 'knowledge', 'model-change', 'repo-change'].includes(event.type)) {
          const time = formatDate(event.timestamp).split(' ')[1];
          this.print(`  ${time} [${event.type}] ${event.summary}`);
        }
      }
    }
  }

  private async cmdAsk(question: string): Promise<void> {
    if (!question) {
      this.print('Вкажи питання: ask <питання про кодову базу>');
      return;
    }
    const result = await this.core.ask(question, (token) => {
      process.stdout.write(token);
    });
    if (result.notFound) {
      this.print(result.answer);
    } else {
      process.stdout.write('\n');
    }
    if (result.sources.length > 0) {
      this.print('\nДжерела (перевірено по індексу):');
      for (const source of result.sources) {
        this.print(`  - ${source}`);
      }
    } else {
      this.print('\nДжерела: не знайдено');
    }
    if (result.blockedReferences.length > 0) {
      this.print(
        `Заблоковано вигаданих посилань: ${result.blockedReferences.join(', ')}`
      );
    }
    const seconds = (result.durationMs / 1000).toFixed(1);
    this.print(`[модель: ${result.model} | час: ${seconds} с]`);
  }
}