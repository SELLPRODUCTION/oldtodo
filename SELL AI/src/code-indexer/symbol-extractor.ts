import { CodeSymbol, Language, SymbolKind } from '../types/models';

export interface RawImport {
  source: string;
  names: string[];
  line: number;
  system?: boolean;
}

interface SymbolPattern {
  regex: RegExp;
  kind: SymbolKind;
}

const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try',
  'function', 'typeof', 'new', 'delete', 'void', 'with', 'case', 'throw',
]);

const TS_SYMBOL_PATTERNS: SymbolPattern[] = [
  { regex: /(?:^|\n)[ \t]*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
  { regex: /(?:^|\n)[ \t]*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g, kind: 'function' },
  { regex: /(?:^|\n)[ \t]*(export\s+)?interface\s+([A-Za-z_$][\w$]*)/g, kind: 'interface' },
  { regex: /(?:^|\n)[ \t]*(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=\n]*>)?\s*=/g, kind: 'type' },
  { regex: /(?:^|\n)[ \t]*(export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/g, kind: 'enum' },
  { regex: /(?:^|\n)[ \t]*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:\([^)\n]*\)|[A-Za-z_$][\w$]*)\s*=>/g, kind: 'function' },
  { regex: /\n[ \t]{2,}(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)\n]*\)\s*(?::\s*[^{\n]+)?\s*\{/g, kind: 'method' },
];

const PY_SYMBOL_PATTERNS: SymbolPattern[] = [
  { regex: /(?:^|\n)[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)/g, kind: 'function' },
  { regex: /(?:^|\n)[ \t]*class\s+([A-Za-z_]\w*)/g, kind: 'class' },
];

const GO_SYMBOL_PATTERNS: SymbolPattern[] = [
  { regex: /(?:^|\n)func\s+(?:\([^)\n]*\)\s*)?([A-Za-z_]\w*)/g, kind: 'function' },
  { regex: /(?:^|\n)type\s+([A-Za-z_]\w*)\s+struct\b/g, kind: 'class' },
  { regex: /(?:^|\n)type\s+([A-Za-z_]\w*)\s+interface\b/g, kind: 'interface' },
];

const RUST_SYMBOL_PATTERNS: SymbolPattern[] = [
  { regex: /(?:^|\n)[ \t]*(?:pub(?:\([^)\n]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/g, kind: 'function' },
  { regex: /(?:^|\n)[ \t]*(?:pub(?:\([^)\n]*\))?\s+)?struct\s+([A-Za-z_]\w*)/g, kind: 'class' },
  { regex: /(?:^|\n)[ \t]*(?:pub(?:\([^)\n]*\))?\s+)?enum\s+([A-Za-z_]\w*)/g, kind: 'enum' },
  { regex: /(?:^|\n)[ \t]*(?:pub(?:\([^)\n]*\))?\s+)?trait\s+([A-Za-z_]\w*)/g, kind: 'interface' },
];

const JVM_SYMBOL_PATTERNS: SymbolPattern[] = [
  { regex: /(?:^|\n)[ \t]*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial)\s+)*class\s+([A-Za-z_]\w*)/g, kind: 'class' },
  { regex: /(?:^|\n)[ \t]*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial)\s+)*interface\s+([A-Za-z_]\w*)/g, kind: 'interface' },
  { regex: /(?:^|\n)[ \t]*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial)\s+)*enum\s+([A-Za-z_]\w*)/g, kind: 'enum' },
  { regex: /(?:^|\n)[ \t]*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial)\s+)*(?:record|struct)\s+([A-Za-z_]\w*)/g, kind: 'class' },
];

const C_SYMBOL_PATTERNS: SymbolPattern[] = [
  { regex: /(?:^|\n)[ \t]*(?:(?:static|inline|extern|unsigned|signed|const|volatile)\s+)*(?:[A-Za-z_]\w*\s*\**\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/g, kind: 'function' },
  { regex: /(?:^|\n)[ \t]*(?:typedef\s+)?(?:struct|union)\s+([A-Za-z_]\w*)/g, kind: 'class' },
  { regex: /(?:^|\n)[ \t]*(?:typedef\s+)?enum\s+([A-Za-z_]\w*)/g, kind: 'enum' },
  { regex: /(?:^|\n)[ \t]*#\s*define\s+([A-Za-z_]\w*)/g, kind: 'variable' },
  { regex: /(?:^|\n)[ \t]*typedef\s+[\s\S]*?\b([A-Za-z_]\w*)\s*;/g, kind: 'type' },
];

const C_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'return', 'sizeof', 'else', 'do', 'case',
]);

function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function patternsFor(language: Language): SymbolPattern[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return TS_SYMBOL_PATTERNS;
    case 'python':
      return PY_SYMBOL_PATTERNS;
    case 'go':
      return GO_SYMBOL_PATTERNS;
    case 'rust':
      return RUST_SYMBOL_PATTERNS;
    case 'java':
    case 'csharp':
      return JVM_SYMBOL_PATTERNS;
    case 'c':
    case 'cpp':
      return C_SYMBOL_PATTERNS;
    default:
      return [];
  }
}

export function extractSymbols(content: string, language: Language): CodeSymbol[] {
  const patterns = patternsFor(language);
  const symbols: CodeSymbol[] = [];
  const seen = new Set<string>();
  for (const { regex, kind } of patterns) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[match.length - 1];
      if (!name) continue;
      if ((language === 'typescript' || language === 'javascript') && JS_KEYWORDS.has(name)) continue;
      if ((language === 'c' || language === 'cpp') && C_KEYWORDS.has(name)) continue;
      const line = lineAt(content, match.index);
      const key = `${kind}:${name}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let exported: boolean;
      if (language === 'python') {
        exported = !name.startsWith('_');
      } else if (language === 'rust') {
        exported = /\bpub\b/.test(match[0]);
      } else if (language === 'java' || language === 'csharp') {
        exported = /\b(public|internal)\b/.test(match[0]);
      } else if (language === 'go') {
        exported = /^[A-Z]/.test(name);
      } else if (language === 'c' || language === 'cpp') {
        exported = !/\bstatic\b/.test(match[0]);
      } else {
        exported = /\bexport\b/.test(match[0]);
      }
      symbols.push({ name, kind, line, exported });
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
  }
  symbols.sort((a, b) => a.line - b.line);
  return symbols;
}

function parseImportNames(clause: string | undefined): string[] {
  if (!clause) return [];
  const cleaned = clause.replace(/\btype\b/g, '').replace(/[{}]/g, ' ');
  return cleaned
    .split(',')
    .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
    .filter((part) => part.length > 0 && part !== '*');
}

function dedupeImports(imports: RawImport[]): RawImport[] {
  const seen = new Set<string>();
  const result: RawImport[] = [];
  for (const imp of imports) {
    const key = `${imp.source}:${imp.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(imp);
  }
  return result;
}

function extractTsJsImports(content: string): RawImport[] {
  const imports: RawImport[] = [];
  const patterns: RegExp[] = [
    /import\s+(?:type\s+)?(?:([\w$*\s{},]+?)\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /export\s+(?:\*|\{[^}\n]*\})\s+from\s+['"]([^'"\n]+)['"]/g,
    /require\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ];
  patterns.forEach((regex, patternIndex) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const source = patternIndex === 0 ? match[2] : match[1];
      if (!source) continue;
      const names = patternIndex === 0 ? parseImportNames(match[1]) : [];
      imports.push({ source, names, line: lineAt(content, match.index) });
    }
  });
  return dedupeImports(imports);
}

function extractPythonImports(content: string): RawImport[] {
  const imports: RawImport[] = [];
  const importRegex = /^[ \t]*import\s+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const modules = match[1].split(',').map((m) => m.trim()).filter(Boolean);
    for (const module of modules) {
      imports.push({ source: module, names: [], line: lineAt(content, match.index) });
    }
  }
  const fromRegex = /^[ \t]*from\s+([\w.]+)\s+import\s+([^\n#]+)/gm;
  while ((match = fromRegex.exec(content)) !== null) {
    const names = match[2]
      .replace(/[()]/g, '')
      .split(',')
      .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
      .filter((n) => n.length > 0 && n !== '*');
    imports.push({ source: match[1], names, line: lineAt(content, match.index) });
  }
  return dedupeImports(imports);
}

function extractGoImports(content: string): RawImport[] {
  const imports: RawImport[] = [];
  const singleRegex = /(?:^|\n)import\s+(?:[\w.]+\s+)?"([^"\n]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = singleRegex.exec(content)) !== null) {
    imports.push({ source: match[1], names: [], line: lineAt(content, match.index) });
  }
  const blockRegex = /(?:^|\n)import\s*\(([\s\S]*?)\)/g;
  while ((match = blockRegex.exec(content)) !== null) {
    const blockStart = match.index;
    const lineRegex = /"([^"\n]+)"/g;
    let inner: RegExpExecArray | null;
    while ((inner = lineRegex.exec(match[1])) !== null) {
      imports.push({
        source: inner[1],
        names: [],
        line: lineAt(content, blockStart + inner.index),
      });
    }
  }
  return dedupeImports(imports);
}

function extractJvmImports(content: string): RawImport[] {
  const imports: RawImport[] = [];
  const javaRegex = /^[ \t]*import\s+(?:static\s+)?([\w.*]+)\s*;/gm;
  const csRegex = /^[ \t]*using\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let match: RegExpExecArray | null;
  while ((match = javaRegex.exec(content)) !== null) {
    imports.push({ source: match[1], names: [], line: lineAt(content, match.index) });
  }
  while ((match = csRegex.exec(content)) !== null) {
    imports.push({ source: match[1], names: [], line: lineAt(content, match.index) });
  }
  return dedupeImports(imports);
}

function extractRustImports(content: string): RawImport[] {
  const imports: RawImport[] = [];
  const useRegex = /^[ \t]*(?:pub\s+)?use\s+([\w:]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = useRegex.exec(content)) !== null) {
    imports.push({ source: match[1], names: [], line: lineAt(content, match.index) });
  }
  return dedupeImports(imports);
}

function extractCImports(content: string): RawImport[] {
  const imports: RawImport[] = [];
  const includeRegex = /(?:^|\n)[ \t]*#\s*include\s+([<"])([^>"]+)[>"]/g;
  let match: RegExpExecArray | null;
  while ((match = includeRegex.exec(content)) !== null) {
    imports.push({
      source: match[2],
      names: [],
      line: lineAt(content, match.index),
      system: match[1] === '<',
    });
  }
  return dedupeImports(imports);
}

export function extractImports(content: string, language: Language): RawImport[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return extractTsJsImports(content);
    case 'python':
      return extractPythonImports(content);
    case 'go':
      return extractGoImports(content);
    case 'java':
    case 'csharp':
      return extractJvmImports(content);
    case 'rust':
      return extractRustImports(content);
    case 'c':
    case 'cpp':
      return extractCImports(content);
    default:
      return [];
  }
}