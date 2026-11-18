import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IndexerConfig, Language, ScannedFile } from '../types/models';

const LANGUAGE_BY_EXT: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.rb': 'ruby',
  '.php': 'php',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bat': 'shell',
  '.ps1': 'shell',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
};

export function detectLanguage(fileName: string): Language {
  const base = fileName.toLowerCase();
  if (base === '.env.example' || base === '.env') return 'ini';
  if (base === 'dockerfile') return 'shell';
  if (base === 'makefile') return 'shell';
  const ext = path.extname(base);
  return LANGUAGE_BY_EXT[ext] ?? 'unknown';
}

interface GitignoreRule {
  negated: boolean;
  dirOnly: boolean;
  regex: RegExp;
}

function escapeRegex(ch: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? `\\${ch}` : ch;
}

function compileGitignorePattern(raw: string): GitignoreRule | null {
  let pattern = raw.trim();
  if (!pattern || pattern.startsWith('#')) return null;
  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  }
  const dirOnly = pattern.endsWith('/');
  if (dirOnly) pattern = pattern.slice(0, -1);
  if (pattern.startsWith('/')) pattern = pattern.slice(1);
  const anchored = pattern.includes('/');
  let regexStr = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        regexStr += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        regexStr += '[^/]*';
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
    } else {
      regexStr += escapeRegex(ch);
    }
  }
  if (!regexStr) return null;
  const regex = anchored
    ? new RegExp(`^${regexStr}(/.*)?$`)
    : new RegExp(`(^|/)${regexStr}(/.*)?$`);
  return { negated, dirOnly, regex };
}

export class FileScanner {
  constructor(private readonly config: IndexerConfig) {}

  private loadGitignoreRules(repoPath: string): GitignoreRule[] {
    const rules: GitignoreRule[] = [];
    const gitignorePath = path.join(repoPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      try {
        const lines = fs.readFileSync(gitignorePath, 'utf-8').split(/\r?\n/);
        for (const line of lines) {
          const rule = compileGitignorePattern(line);
          if (rule) rules.push(rule);
        }
      } catch {
        return rules;
      }
    }
    return rules;
  }

  private isIgnored(rules: GitignoreRule[], relPath: string, isDir: boolean): boolean {
    let ignored = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) {
        if (rule.regex.test(relPath)) ignored = !rule.negated;
        continue;
      }
      if (rule.regex.test(relPath)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }

  scan(repoPath: string): ScannedFile[] {
    const rules = this.loadGitignoreRules(repoPath);
    const excludeDirs = new Set(this.config.excludeDirs);
    const includeExts = new Set(this.config.includeExtensions.map((e) => e.toLowerCase()));
    const maxBytes = this.config.maxFileSizeKb * 1024;
    const results: ScannedFile[] = [];

    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const rel = path.relative(repoPath, abs).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (excludeDirs.has(entry.name)) continue;
          if (entry.name.startsWith('.') && entry.name !== '.github') continue;
          if (this.isIgnored(rules, rel, true)) continue;
          walk(abs);
        } else if (entry.isFile()) {
          const base = entry.name.toLowerCase();
          const ext = path.extname(base);
          const allowed =
            includeExts.has(ext) ||
            includeExts.has(base) ||
            base === 'dockerfile' ||
            base === 'makefile';
          if (!allowed) continue;
          if (this.isIgnored(rules, rel, false)) continue;
          let stat: fs.Stats;
          try {
            stat = fs.statSync(abs);
          } catch {
            continue;
          }
          if (stat.size === 0 || stat.size > maxBytes) continue;
          let content: Buffer;
          try {
            content = fs.readFileSync(abs);
          } catch {
            continue;
          }
          if (content.includes(0)) continue;
          const hash = crypto.createHash('sha1').update(content).digest('hex');
          results.push({
            path: rel,
            absolutePath: abs,
            sizeBytes: stat.size,
            modifiedAt: stat.mtimeMs,
            hash,
            language: detectLanguage(entry.name),
          });
        }
      }
    };

    walk(repoPath);
    results.sort((a, b) => a.path.localeCompare(b.path));
    return results;
  }
}