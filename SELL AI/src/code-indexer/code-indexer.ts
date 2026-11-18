import * as fs from 'fs';
import { ICodeIndexer } from '../types/contracts';
import {
  ContentMatch,
  FileMatch,
  FileRecord,
  ImportRef,
  IndexSnapshot,
  IndexStats,
  ScanChanges,
  ScanResult,
  ScannedFile,
  SellAiConfig,
} from '../types/models';
import { JsonStore } from '../utils/json-store';
import { scoreText, tokenize } from '../utils/text';
import { FileScanner } from './file-scanner';
import { extractImports, extractSymbols, RawImport } from './symbol-extractor';

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.cs'];

export const EXTRACTOR_VERSION = 2;

const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'events',
  'stream', 'child_process', 'assert', 'buffer', 'zlib', 'net', 'readline',
  'process', 'timers', 'querystring', 'string_decoder', 'worker_threads',
  'perf_hooks', 'async_hooks', 'dns', 'tls', 'dgram', 'cluster', 'v8', 'vm',
  'module', 'console', 'constants', 'punycode', 'tty', 'repl', 'inspector',
  'trace_events', 'wasi', 'diagnostics_channel', 'test', 'sqlite', 'sea',
]);

const PYTHON_STDLIB = new Set([
  'os', 'sys', 're', 'json', 'typing', 'math', 'datetime', 'collections',
  'itertools', 'functools', 'pathlib', 'subprocess', 'logging', 'asyncio',
  'dataclasses', 'enum', 'abc', 'io', 'time', 'random', 'string', 'unittest',
  'argparse', 'shutil', 'glob', 'copy', 'hashlib', 'base64', 'uuid',
  'threading', 'multiprocessing', 'socket', 'http', 'urllib', 'contextlib',
  'warnings', 'traceback', 'inspect', 'importlib', 'pickle', 'csv', 'sqlite3',
  'tempfile', 'textwrap', 'struct', 'operator', 'statistics', 'decimal',
  'fractions', 'secrets', 'signal', 'queue', 'heapq', 'bisect', 'array',
  'weakref', 'types', 'codecs', 'locale', 'gettext', 'platform', 'errno',
  'stat', 'fnmatch', 'linecache', 'tokenize', 'ast', 'dis', 'gc', 'atexit',
  'builtins', '__future__', 'pytest',
]);

function normalizePosix(input: string): string {
  const parts = input.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

function dirnamePosix(relPath: string): string {
  const parts = relPath.split('/');
  parts.pop();
  return parts.join('/');
}

function probePath(target: string, fileSet: Set<string>): string | null {
  if (fileSet.has(target)) return target;
  for (const ext of RESOLVE_EXTENSIONS) {
    if (fileSet.has(target + ext)) return target + ext;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexCandidate = `${target}/index${ext}`;
    if (fileSet.has(indexCandidate)) return indexCandidate;
  }
  if (fileSet.has(`${target}/__init__.py`)) return `${target}/__init__.py`;
  return null;
}

function computeStats(files: FileRecord[]): IndexStats {
  const byLanguage: Record<string, number> = {};
  let totalLines = 0;
  let totalSizeBytes = 0;
  for (const file of files) {
    byLanguage[file.language] = (byLanguage[file.language] ?? 0) + 1;
    totalLines += file.lines;
    totalSizeBytes += file.sizeBytes;
  }
  return { totalFiles: files.length, totalLines, totalSizeBytes, byLanguage };
}

export class CodeIndexer implements ICodeIndexer {
  private snapshot: IndexSnapshot | null;

  constructor(
    private readonly config: SellAiConfig,
    private readonly store: JsonStore<IndexSnapshot | null>
  ) {
    this.snapshot = store.load();
  }

  getIndex(): IndexSnapshot | null {
    return this.snapshot;
  }

  async scan(): Promise<ScanResult> {
    const repoPath = this.config.repoPath;
    if (!fs.existsSync(repoPath)) {
      throw new Error(
        `Репозиторій не знайдено: ${repoPath}. Вкажи правильний шлях у sellai.config.json або командою: repo <шлях>`
      );
    }
    const scanner = new FileScanner(this.config.indexer);
    const scanned = scanner.scan(repoPath);
    const previous =
      this.snapshot && this.snapshot.repoPath === repoPath ? this.snapshot : null;
    const prevByPath = new Map<string, FileRecord>(
      (previous?.files ?? []).map((f) => [f.path, f])
    );
    const fileSet = new Set(scanned.map((f) => f.path));
    const staleExtractor =
      !previous || previous.extractorVersion !== EXTRACTOR_VERSION;
    const files: FileRecord[] = [];
    const changes: ScanChanges = { added: [], changed: [], removed: [], unchanged: 0 };

    for (const sf of scanned) {
      const prev = prevByPath.get(sf.path);
      if (prev && prev.hash === sf.hash) {
        files.push(staleExtractor ? this.indexFile(sf, fileSet) : prev);
        changes.unchanged++;
        continue;
      }
      const record = this.indexFile(sf, fileSet);
      files.push(record);
      if (prev) {
        changes.changed.push(sf.path);
      } else {
        changes.added.push(sf.path);
      }
    }
    for (const prevFile of previous?.files ?? []) {
      if (!fileSet.has(prevFile.path)) {
        changes.removed.push(prevFile.path);
      }
    }

    const snapshot: IndexSnapshot = {
      repoPath,
      extractorVersion: EXTRACTOR_VERSION,
      createdAt: previous?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      files,
      stats: computeStats(files),
    };
    this.snapshot = snapshot;
    this.store.save(snapshot);
    return { snapshot, changes };
  }

  private indexFile(sf: ScannedFile, fileSet: Set<string>): FileRecord {
    let content = '';
    try {
      content = fs.readFileSync(sf.absolutePath, 'utf-8');
    } catch {
      content = '';
    }
    const symbols = extractSymbols(content, sf.language);
    const rawImports = extractImports(content, sf.language);
    const imports = rawImports.map((raw) => this.resolveImport(raw, sf, fileSet));
    return {
      ...sf,
      lines: content.length > 0 ? content.split('\n').length : 0,
      symbols,
      imports,
      indexedAt: Date.now(),
    };
  }

  private resolveImport(raw: RawImport, file: ScannedFile, fileSet: Set<string>): ImportRef {
    const source = raw.source;
    const base = { source, names: raw.names, line: raw.line };

    if (file.language === 'python') {
      if (source.startsWith('.')) {
        const dots = source.match(/^\.+/)?.[0].length ?? 1;
        let baseDir = dirnamePosix(file.path);
        for (let i = 1; i < dots; i++) {
          baseDir = dirnamePosix(baseDir);
        }
        const tail = source.slice(dots).replace(/\./g, '/');
        const target = normalizePosix(baseDir ? `${baseDir}/${tail}` : tail);
        const resolved = tail ? probePath(target, fileSet) : probePath(baseDir, fileSet);
        return { ...base, resolvedPath: resolved, kind: resolved ? 'internal' : 'unresolved' };
      }
      const asPath = source.replace(/\./g, '/');
      const candidates = [asPath, `${dirnamePosix(file.path)}/${asPath}`];
      for (const candidate of candidates) {
        const resolved = probePath(normalizePosix(candidate), fileSet);
        if (resolved) {
          return { ...base, resolvedPath: resolved, kind: 'internal' };
        }
      }
      const rootModule = source.split('.')[0];
      const kind = PYTHON_STDLIB.has(rootModule) ? 'builtin' : 'package';
      return { ...base, resolvedPath: null, kind };
    }

    if (file.language === 'c' || file.language === 'cpp') {
      if (raw.system) {
        return { ...base, resolvedPath: null, kind: 'builtin' };
      }
      const baseDir = dirnamePosix(file.path);
      const candidates = [
        normalizePosix(baseDir ? `${baseDir}/${source}` : source),
        normalizePosix(source),
        normalizePosix(`src/${source}`),
        normalizePosix(baseDir ? `${baseDir}/../${source}` : `../${source}`),
      ];
      for (const candidate of candidates) {
        const resolved = probePath(candidate, fileSet);
        if (resolved) {
          return { ...base, resolvedPath: resolved, kind: 'internal' };
        }
      }
      return { ...base, resolvedPath: null, kind: 'builtin' };
    }

    if (file.language === 'rust') {
      const kind = /^(crate|self|super)(::|$)/.test(source) ? 'unresolved' : 'package';
      return { ...base, resolvedPath: null, kind };
    }

    if (source.startsWith('.')) {
      const baseDir = dirnamePosix(file.path);
      const target = normalizePosix(baseDir ? `${baseDir}/${source}` : source);
      const resolved = probePath(target, fileSet);
      return { ...base, resolvedPath: resolved, kind: resolved ? 'internal' : 'unresolved' };
    }

    if (source.startsWith('@/') || source.startsWith('~/') || source.startsWith('src/')) {
      const stripped = source.replace(/^[@~]\//, '');
      const resolved =
        probePath(stripped, fileSet) ?? probePath(`src/${stripped}`, fileSet);
      if (resolved) {
        return { ...base, resolvedPath: resolved, kind: 'internal' };
      }
    }

    if (file.language === 'typescript' || file.language === 'javascript') {
      if (source.startsWith('node:')) {
        return { ...base, resolvedPath: null, kind: 'builtin' };
      }
      const rootPackage = source.startsWith('@')
        ? source.split('/').slice(0, 2).join('/')
        : source.split('/')[0];
      if (NODE_BUILTINS.has(rootPackage)) {
        return { ...base, resolvedPath: null, kind: 'builtin' };
      }
      return { ...base, resolvedPath: null, kind: 'package' };
    }

    return { ...base, resolvedPath: null, kind: 'package' };
  }

  findFiles(query: string, limit = 10): FileMatch[] {
    const index = this.snapshot;
    if (!index) return [];
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const matches: FileMatch[] = [];
    for (const file of index.files) {
      const reasons: string[] = [];
      let score = scoreText(tokens, file.path) * 3;
      if (score > 0) reasons.push('збіг у шляху файлу');
      let symbolScore = 0;
      const matchedSymbols: string[] = [];
      for (const symbol of file.symbols) {
        const symbolLower = symbol.name.toLowerCase();
        for (const token of tokens) {
          if (symbolLower.includes(token)) {
            symbolScore += 4;
            matchedSymbols.push(symbol.name);
            break;
          }
        }
        if (symbolScore >= 16) break;
      }
      if (symbolScore > 0) {
        score += symbolScore;
        reasons.push(`символи: ${[...new Set(matchedSymbols)].slice(0, 5).join(', ')}`);
      }
      if (score > 0) {
        matches.push({ file, score, reasons });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
  }

  searchContent(query: string, limit = 40): ContentMatch[] {
    const index = this.snapshot;
    if (!index || !query.trim()) return [];
    const needle = query.toLowerCase();
    const matches: ContentMatch[] = [];
    for (const file of index.files) {
      let content: string;
      try {
        content = fs.readFileSync(file.absolutePath, 'utf-8');
      } catch {
        continue;
      }
      if (!content.toLowerCase().includes(needle)) continue;
      const lines = content.split('\n');
      let perFile = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          matches.push({ path: file.path, line: i + 1, text: lines[i].trim().slice(0, 200) });
          perFile++;
          if (perFile >= 5 || matches.length >= limit) break;
        }
      }
      if (matches.length >= limit) break;
    }
    return matches;
  }

  readFile(relPath: string): string | null {
    const index = this.snapshot;
    if (!index) return null;
    const normalized = relPath.split('\\').join('/').replace(/^\.\//, '');
    const record = index.files.find((f) => f.path === normalized);
    if (!record) return null;
    try {
      return fs.readFileSync(record.absolutePath, 'utf-8');
    } catch {
      return null;
    }
  }
}