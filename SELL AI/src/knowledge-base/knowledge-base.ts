import * as path from 'path';
import * as crypto from 'crypto';
import { IKnowledgeBase } from '../types/contracts';
import {
  IndexSnapshot,
  KnowledgeEntry,
  KnowledgeSource,
  ProjectGraphData,
} from '../types/models';
import { JsonStore } from '../utils/json-store';
import { formatBytes, formatDate, scoreText, slugify, tokenize } from '../utils/text';

export class KnowledgeBase implements IKnowledgeBase {
  private entries: KnowledgeEntry[];

  constructor(private readonly store: JsonStore<KnowledgeEntry[]>) {
    this.entries = store.load();
  }

  add(
    topic: string,
    content: string,
    source: KnowledgeSource,
    tags: string[] = [],
    filePaths: string[] = []
  ): KnowledgeEntry {
    const existing = this.entries.find((e) => e.topic === topic && e.source === source);
    if (existing) {
      existing.content = content;
      existing.tags = tags;
      existing.filePaths = filePaths;
      existing.updatedAt = Date.now();
      this.store.save(this.entries);
      return existing;
    }
    const entry: KnowledgeEntry = {
      id: `${source}:${slugify(topic) || crypto.randomUUID().slice(0, 8)}`,
      topic,
      content,
      source,
      tags,
      filePaths,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (this.entries.some((e) => e.id === entry.id)) {
      entry.id = `${entry.id}:${crypto.randomUUID().slice(0, 8)}`;
    }
    this.entries.push(entry);
    this.store.save(this.entries);
    return entry;
  }

  update(id: string, content: string): KnowledgeEntry | null {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return null;
    entry.content = content;
    entry.updatedAt = Date.now();
    this.store.save(this.entries);
    return entry;
  }

  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length === before) return false;
    this.store.save(this.entries);
    return true;
  }

  get(id: string): KnowledgeEntry | null {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  all(): KnowledgeEntry[] {
    return [...this.entries].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  search(query: string, limit = 5): KnowledgeEntry[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const scored = this.entries
      .map((entry) => ({
        entry,
        score:
          scoreText(tokens, entry.topic) * 3 +
          scoreText(tokens, entry.content) +
          scoreText(tokens, entry.tags.join(' ')) * 2,
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.entry);
  }

  rebuildFromIndex(index: IndexSnapshot, graph: ProjectGraphData): number {
    this.entries = this.entries.filter((e) => e.source !== 'scan');
    const scanTags = ['scan', 'авто'];

    const languageLines = Object.entries(index.stats.byLanguage)
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => `- ${lang}: ${count} файл(ів)`)
      .join('\n');
    this.add(
      'Огляд проєкту',
      `Репозиторій: ${index.repoPath}\n` +
      `Файлів: ${index.stats.totalFiles}, рядків: ${index.stats.totalLines}, ` +
      `розмір: ${formatBytes(index.stats.totalSizeBytes)}.\n` +
      `Оновлено індекс: ${formatDate(index.updatedAt)}.\n` +
      `Мови:\n${languageLines}`,
      'scan',
      [...scanTags, 'огляд'],
      []
    );

    const entryLines = graph.entryPoints
      .map((p) => `- ${p} — ${(graph.entryReasons[p] ?? []).join('; ')}`)
      .join('\n');
    this.add(
      'Точки входу проєкту',
      entryLines || 'Точок входу не виявлено.',
      'scan',
      [...scanTags, 'точки входу'],
      graph.entryPoints
    );

    const packageLines = Object.entries(graph.externalPackages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([pkg, count]) => `- ${pkg}: використовується у ${count} імпорт(ах)`)
      .join('\n');
    this.add(
      'Зовнішні залежності',
      packageLines || 'Зовнішніх залежностей не виявлено.',
      'scan',
      [...scanTags, 'залежності'],
      []
    );

    const byDir = new Map<string, typeof index.files>();
    for (const file of index.files) {
      const parts = file.path.split('/');
      const dir = parts.length > 1 ? parts[0] : '(корінь)';
      const list = byDir.get(dir) ?? [];
      list.push(file);
      byDir.set(dir, list);
    }
    for (const [dir, files] of byDir) {
      const languages = [...new Set(files.map((f) => f.language))].join(', ');
      const exportedSymbols = files
        .flatMap((f) => f.symbols.filter((s) => s.exported).map((s) => `${s.name} (${f.path})`))
        .slice(0, 15);
      const dirEntries = graph.entryPoints.filter(
        (p) => p === dir || p.startsWith(`${dir}/`) || (dir === '(корінь)' && !p.includes('/'))
      );
      this.add(
        `Модуль: ${dir}`,
        `Файлів: ${files.length}. Мови: ${languages}.\n` +
        `Експортовані символи: ${exportedSymbols.length > 0 ? exportedSymbols.join(', ') : 'немає'}.\n` +
        `Точки входу в модулі: ${dirEntries.length > 0 ? dirEntries.join(', ') : 'немає'}.`,
        'scan',
        [...scanTags, 'модуль', dir],
        files.map((f) => f.path).slice(0, 50)
      );
    }

    const connected = [...graph.nodes]
      .sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree))
      .slice(0, 10)
      .map((n) => `- ${n.id}: імпортується ${n.inDegree} раз(и), імпортує ${n.outDegree} файл(ів)`)
      .join('\n');
    this.add(
      "Найзв'язаніші файли",
      connected || 'Граф порожній.',
      'scan',
      [...scanTags, 'граф'],
      []
    );

    if (graph.cycles.length > 0) {
      const cycleLines = graph.cycles
        .slice(0, 10)
        .map((cycle) => `- ${cycle.join(' → ')}`)
        .join('\n');
      this.add(
        'Циклічні залежності',
        `Виявлено циклів: ${graph.cycles.length}.\n${cycleLines}`,
        'scan',
        [...scanTags, 'граф', 'цикли'],
        []
      );
    }

    const largest = [...index.files]
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 10)
      .map((f) => `- ${f.path}: ${f.lines} рядків, ${f.symbols.length} символів`)
      .join('\n');
    this.add(
      'Найбільші файли',
      largest || 'Файлів немає.',
      'scan',
      [...scanTags, 'статистика'],
      []
    );

    this.store.save(this.entries);
    return this.entries.filter((e) => e.source === 'scan').length;
  }
}