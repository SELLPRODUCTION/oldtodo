import * as fs from 'fs';
import * as path from 'path';
import { IProjectGraph } from '../types/contracts';
import {
  EntryPointInfo,
  GraphEdge,
  GraphNode,
  IndexSnapshot,
  Language,
  ModuleAnalysis,
  ProjectGraphData,
} from '../types/models';
import { JsonStore } from '../utils/json-store';

const CODE_LANGUAGES = new Set<Language>([
  'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp', 'cpp', 'c', 'ruby', 'php',
]);

const GENERIC_ENTRY_NAMES = new Set([
  'index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs',
  'main.ts', 'main.tsx', 'main.js', 'main.jsx', 'main.mjs',
  'app.ts', 'app.tsx', 'app.js', 'app.jsx',
  'server.ts', 'server.js', 'cli.ts', 'cli.js',
  'main.py', 'app.py', '__main__.py', 'manage.py', 'run.py', 'wsgi.py', 'asgi.py',
  'main.go', 'main.rs', 'lib.rs', 'Program.cs', 'Main.java', 'main.c', 'main.cpp',
]);

function packageName(source: string): string {
  return source.startsWith('@')
    ? source.split('/').slice(0, 2).join('/')
    : source.split('/')[0];
}

function normalizeRel(input: string): string {
  return input.split('\\').join('/').replace(/^\.\//, '');
}

export class ProjectGraph implements IProjectGraph {
  private graph: ProjectGraphData | null;
  private lastIndex: IndexSnapshot | null = null;

  constructor(private readonly store: JsonStore<ProjectGraphData | null>) {
    this.graph = store.load();
  }

  attachIndex(index: IndexSnapshot): void {
    this.lastIndex = index;
  }

  getGraph(): ProjectGraphData | null {
    return this.graph;
  }

  build(index: IndexSnapshot): ProjectGraphData {
    this.lastIndex = index;
    const nodes: GraphNode[] = index.files.map((f) => ({
      id: f.path,
      language: f.language,
      symbolCount: f.symbols.length,
      inDegree: 0,
      outDegree: 0,
      isEntryPoint: false,
    }));
    const nodeById = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
    const edgeMap = new Map<string, GraphEdge>();
    const externalPackages: Record<string, number> = {};

    for (const file of index.files) {
      for (const imp of file.imports) {
        if (imp.kind === 'internal' && imp.resolvedPath && imp.resolvedPath !== file.path) {
          const target = nodeById.get(imp.resolvedPath);
          if (!target) continue;
          const key = `${file.path}\u0000${imp.resolvedPath}`;
          const existing = edgeMap.get(key);
          if (existing) {
            for (const name of imp.names) {
              if (!existing.names.includes(name)) existing.names.push(name);
            }
          } else {
            edgeMap.set(key, { from: file.path, to: imp.resolvedPath, names: [...imp.names] });
          }
        } else if (imp.kind === 'package') {
          const pkg = packageName(imp.source);
          externalPackages[pkg] = (externalPackages[pkg] ?? 0) + 1;
        }
      }
    }

    const edges = [...edgeMap.values()];
    for (const edge of edges) {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (from) from.outDegree++;
      if (to) to.inDegree++;
    }

    const entryReasons = this.detectEntryPoints(index, nodeById);
    const entryPoints = Object.keys(entryReasons);
    for (const entry of entryPoints) {
      const node = nodeById.get(entry);
      if (node) node.isEntryPoint = true;
    }

    const cycles = this.detectCycles(nodes, edges);

    const graph: ProjectGraphData = {
      repoPath: index.repoPath,
      updatedAt: Date.now(),
      nodes,
      edges,
      entryPoints,
      entryReasons,
      externalPackages,
      cycles,
    };
    this.graph = graph;
    this.store.save(graph);
    return graph;
  }

  private addReason(reasons: Record<string, string[]>, filePath: string, reason: string): void {
    const list = reasons[filePath] ?? [];
    if (!list.includes(reason)) list.push(reason);
    reasons[filePath] = list;
  }

  private detectEntryPoints(
    index: IndexSnapshot,
    nodeById: Map<string, GraphNode>
  ): Record<string, string[]> {
    const reasons: Record<string, string[]> = {};
    const fileSet = new Set(index.files.map((f) => f.path));

    const resolveRef = (ref: string): string | null => {
      const clean = normalizeRel(ref);
      if (fileSet.has(clean)) return clean;
      for (const prefix of ['', 'src/', 'app/', 'cmd/']) {
        for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go']) {
          const candidate = `${prefix}${clean}${ext}`;
          if (fileSet.has(candidate)) return candidate;
        }
      }
      return null;
    };

    const pkgFile = index.files.find((f) => f.path === 'package.json');
    if (pkgFile) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile.absolutePath, 'utf-8')) as Record<string, unknown>;
        const refs: { value: unknown; label: string }[] = [
          { value: pkg.main, label: 'package.json → main' },
          { value: pkg.module, label: 'package.json → module' },
        ];
        if (typeof pkg.bin === 'string') {
          refs.push({ value: pkg.bin, label: 'package.json → bin' });
        } else if (pkg.bin && typeof pkg.bin === 'object') {
          for (const [name, value] of Object.entries(pkg.bin as Record<string, unknown>)) {
            refs.push({ value, label: `package.json → bin.${name}` });
          }
        }
        const scripts = pkg.scripts;
        if (scripts && typeof scripts === 'object') {
          for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
            if (typeof value !== 'string') continue;
            if (!/^(start|dev|serve|main)/.test(name)) continue;
            const fileRefs = value.match(/[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py)\b/g) ?? [];
            for (const ref of fileRefs) {
              refs.push({ value: ref, label: `package.json → scripts.${name}` });
            }
          }
        }
        for (const { value, label } of refs) {
          if (typeof value !== 'string') continue;
          const resolved = resolveRef(value);
          if (resolved) this.addReason(reasons, resolved, label);
        }
      } catch {
        // невалідний package.json — пропускаємо
      }
    }

    const setupPy = index.files.find((f) => f.path === 'setup.py');
    if (setupPy) {
      try {
        const content = fs.readFileSync(setupPy.absolutePath, 'utf-8');
        const consoleScripts = content.match(/[\w.]+:[\w.]+/g) ?? [];
        for (const entry of consoleScripts) {
          const modulePart = entry.split(':')[0].replace(/\./g, '/');
          const resolved = resolveRef(`${modulePart}.py`) ?? resolveRef(modulePart);
          if (resolved) this.addReason(reasons, resolved, 'setup.py → console_scripts');
        }
      } catch {
        // пропускаємо
      }
    }

    for (const file of index.files) {
      const base = path.posix.basename(file.path);
      const depth = file.path.split('/').length;
      if (GENERIC_ENTRY_NAMES.has(base) && depth <= 2) {
        this.addReason(reasons, file.path, `стандартне ім'я точки входу (${base})`);
      }
      if (file.language === 'python' && file.sizeBytes < 200_000) {
        try {
          const content = fs.readFileSync(file.absolutePath, 'utf-8');
          if (/if\s+__name__\s*==\s*['"]__main__['"]/.test(content)) {
            this.addReason(reasons, file.path, "блок if __name__ == '__main__'");
          }
        } catch {
          // пропускаємо
        }
      }
      if ((file.language === 'c' || file.language === 'cpp') && file.sizeBytes < 200_000) {
        try {
          const content = fs.readFileSync(file.absolutePath, 'utf-8');
          if (/\b(?:int|void)\s+main\s*\(/.test(content)) {
            this.addReason(reasons, file.path, 'функція main()');
          }
        } catch {
          // пропускаємо
        }
      }
      if (file.language === 'html' && depth === 1) {
        this.addReason(reasons, file.path, 'коренева HTML-сторінка');
      }
      if (file.language === 'shell' && (depth === 1 || file.path.startsWith('scripts/'))) {
        this.addReason(reasons, file.path, 'скрипт запуску');
      }
    }

    for (const node of nodeById.values()) {
      if (
        CODE_LANGUAGES.has(node.language) &&
        node.inDegree === 0 &&
        node.outDegree > 0 &&
        node.symbolCount > 0
      ) {
        this.addReason(reasons, node.id, 'не імпортується іншими файлами, але імпортує інші');
      }
    }

    return reasons;
  }

  private detectCycles(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
    const adjacency = new Map<string, string[]>();
    for (const node of nodes) adjacency.set(node.id, []);
    for (const edge of edges) {
      adjacency.get(edge.from)?.push(edge.to);
    }
    const state = new Map<string, number>();
    const stack: string[] = [];
    const cycles: string[][] = [];
    const seenCycles = new Set<string>();

    const dfs = (id: string): void => {
      if (cycles.length >= 20) return;
      state.set(id, 1);
      stack.push(id);
      for (const next of adjacency.get(id) ?? []) {
        const nextState = state.get(next) ?? 0;
        if (nextState === 0) {
          dfs(next);
        } else if (nextState === 1) {
          const start = stack.indexOf(next);
          if (start >= 0) {
            const cycle = stack.slice(start);
            const key = [...cycle].sort().join('|');
            if (!seenCycles.has(key)) {
              seenCycles.add(key);
              cycles.push([...cycle, next]);
            }
          }
        }
      }
      stack.pop();
      state.set(id, 2);
    };

    for (const node of nodes) {
      if ((state.get(node.id) ?? 0) === 0) dfs(node.id);
      if (cycles.length >= 20) break;
    }
    return cycles;
  }

  getEntryPoints(): EntryPointInfo[] {
    const graph = this.graph;
    if (!graph) return [];
    return graph.entryPoints.map((p) => ({
      path: p,
      reasons: graph.entryReasons[p] ?? [],
    }));
  }

  getNeighbors(relPath: string, direction: 'in' | 'out' | 'both'): GraphEdge[] {
    const graph = this.graph;
    if (!graph) return [];
    const id = normalizeRel(relPath);
    return graph.edges.filter((edge) => {
      if (direction === 'in') return edge.to === id;
      if (direction === 'out') return edge.from === id;
      return edge.from === id || edge.to === id;
    });
  }

  findPath(from: string, to: string): string[] | null {
    const graph = this.graph;
    if (!graph) return null;
    const start = normalizeRel(from);
    const goal = normalizeRel(to);
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    if (!nodeIds.has(start) || !nodeIds.has(goal)) return null;
    if (start === goal) return [start];

    const bfs = (undirected: boolean): string[] | null => {
      const adjacency = new Map<string, string[]>();
      for (const edge of graph.edges) {
        const list = adjacency.get(edge.from) ?? [];
        list.push(edge.to);
        adjacency.set(edge.from, list);
        if (undirected) {
          const reverse = adjacency.get(edge.to) ?? [];
          reverse.push(edge.from);
          adjacency.set(edge.to, reverse);
        }
      }
      const visited = new Set<string>([start]);
      const parent = new Map<string, string>();
      const queue: string[] = [start];
      while (queue.length > 0) {
        const current = queue.shift() as string;
        for (const next of adjacency.get(current) ?? []) {
          if (visited.has(next)) continue;
          visited.add(next);
          parent.set(next, current);
          if (next === goal) {
            const result: string[] = [goal];
            let cursor = goal;
            while (cursor !== start) {
              cursor = parent.get(cursor) as string;
              result.unshift(cursor);
            }
            return result;
          }
          queue.push(next);
        }
      }
      return null;
    };

    return bfs(false) ?? bfs(true);
  }

  analyzeModule(relPath: string): ModuleAnalysis {
    const id = normalizeRel(relPath);
    const graph = this.graph;
    const empty: ModuleAnalysis = {
      path: id,
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
    if (!graph) return empty;
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return empty;

    const outEdges = graph.edges.filter((e) => e.from === id);
    const inEdges = graph.edges.filter((e) => e.to === id);
    const fileRecord = this.lastIndex?.files.find((f) => f.path === id);
    const externalPackages = fileRecord
      ? [...new Set(fileRecord.imports.filter((i) => i.kind === 'package').map((i) => packageName(i.source)))]
      : [];
    const dir = path.posix.dirname(id);
    const directorySiblings = (this.lastIndex?.files ?? [])
      .filter((f) => f.path !== id && path.posix.dirname(f.path) === dir)
      .map((f) => f.path)
      .slice(0, 20);

    return {
      path: id,
      found: true,
      isEntryPoint: node.isEntryPoint,
      entryReasons: graph.entryReasons[id] ?? [],
      inDegree: node.inDegree,
      outDegree: node.outDegree,
      imports: outEdges.map((e) => ({ path: e.to, names: e.names })),
      importedBy: inEdges.map((e) => ({ path: e.from, names: e.names })),
      externalPackages,
      symbols: fileRecord?.symbols ?? [],
      directorySiblings,
    };
  }
}