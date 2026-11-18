import { IndexSnapshot, ProjectGraphData } from '../types/models';

export interface ValidationResult {
  valid: string[];
  invalid: string[];
}

const CODE_EXT =
  '(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|cpp|cc|hpp|c|h|rb|php|html|css|scss|json|yaml|yml|md|sql|sh|bat|ps1|toml|ini)';

const TECH_NAME_ALLOWLIST = new Set([
  'node.js', 'express.js', 'next.js', 'nuxt.js', 'vue.js', 'react.js', 'nest.js',
]);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeIdentifier(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function extractReferences(text: string): string[] {
  const prose = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`\n]+)`/g, ' $1 ');
  const candidates = new Set<string>();

  const pathRegex = /\b(?:[\w.@-]+\/)+[\w.@-]+\b/g;
  const fileRegex = new RegExp(`\\b[\\w.-]+\\.${CODE_EXT}\\b`, 'g');
  const snakeRegex = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

  for (const regex of [pathRegex, fileRegex, snakeRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(prose)) !== null) {
      candidates.add(match[0]);
    }
  }

  const refs: string[] = [];
  for (const candidate of candidates) {
    const clean = candidate.replace(/[.,;:]+$/, '').replace(/^\.\//, '');
    if (clean.length < 3) continue;
    if (/^\d+(\.\d+)*$/.test(clean)) continue;
    if (clean.includes('://')) continue;
    if (TECH_NAME_ALLOWLIST.has(clean.toLowerCase())) continue;
    refs.push(clean);
  }
  return [...new Set(refs)];
}

export function validateReferences(
  refs: string[],
  question: string,
  index: IndexSnapshot,
  graph: ProjectGraphData | null
): ValidationResult {
  const paths = new Set<string>();
  const basenames = new Set<string>();
  const stems = new Set<string>();
  const dirs = new Set<string>();
  const dirNames = new Set<string>();
  const identifiers = new Set<string>();

  for (const file of index.files) {
    const lower = file.path.toLowerCase();
    paths.add(lower);
    const parts = lower.split('/');
    const base = parts[parts.length - 1];
    basenames.add(base);
    const stem = base.replace(/\.[^.]+$/, '');
    stems.add(stem);
    identifiers.add(normalizeIdentifier(base));
    identifiers.add(normalizeIdentifier(stem));
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      dirs.add(dir);
      dirNames.add(parts[i - 1]);
      identifiers.add(normalizeIdentifier(parts[i - 1]));
    }
    for (const symbol of file.symbols) {
      identifiers.add(normalizeIdentifier(symbol.name));
    }
  }
  for (const pkg of Object.keys(graph?.externalPackages ?? {})) {
    identifiers.add(normalizeIdentifier(pkg));
  }

  const questionNorm = normalizeIdentifier(question);
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const ref of refs) {
    const clean = ref.toLowerCase().replace(/^\.\//, '');
    const norm = normalizeIdentifier(clean);
    let grounded =
      paths.has(clean) ||
      basenames.has(clean) ||
      stems.has(clean) ||
      dirs.has(clean) ||
      dirNames.has(clean) ||
      identifiers.has(norm);
    if (!grounded && norm.length >= 3) {
      for (const path of paths) {
        if (path.startsWith(`${clean}/`)) {
          grounded = true;
          break;
        }
      }
    }
    if (!grounded && norm.length >= 3) {
      for (const identifier of identifiers) {
        if (identifier.length >= 4 && identifier.includes(norm)) {
          grounded = true;
          break;
        }
      }
    }
    if (!grounded && norm.length >= 4 && questionNorm.includes(norm)) {
      grounded = true;
    }
    if (grounded) {
      valid.push(ref);
    } else {
      invalid.push(ref);
    }
  }
  return { valid, invalid };
}

export function sanitizeAnswer(text: string, invalid: string[]): string {
  let result = text;
  const marker = ' [НЕ ЗНАЙДЕНО В ІНДЕКСІ]';
  const sorted = [...invalid].sort((a, b) => b.length - a.length);
  for (const ref of sorted) {
    const escaped = escapeRegex(ref);
    result = result.replace(
      new RegExp('`' + escaped + '`', 'g'),
      '`' + ref + '`' + marker
    );
    result = result.replace(
      new RegExp(
        '(?<![`\\w/])' + escaped + '(?![`\\w])(?!\\.\\w)(?! \\[НЕ ЗНАЙДЕНО)',
        'g'
      ),
      ref + marker
    );
  }
  return result;
}

export function buildCorrectionMessage(invalid: string[], index: IndexSnapshot): string {
  const fileList = index.files.map((f) => f.path).slice(0, 300).join('\n');
  return (
    `Системна перевірка джерел SELL AI виявила у твоїй відповіді посилання на файли/модулі, ` +
    `яких НЕМАЄ в індексі репозиторію: ${invalid.join(', ')}.\n\n` +
    `Повний список файлів, які реально існують у репозиторії:\n${fileList}\n\n` +
    `Перепиши відповідь заново: спирайся лише на файли з цього списку та на раніше наданий контекст. ` +
    `Згадуй тільки файли зі списку вище. Якщо інформації немає — напиши «не знайдено». ` +
    `Не вигадуй файли, модулі чи методи.`
  );
}