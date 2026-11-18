import { ICodeIndexer, IProjectGraph } from '../types/contracts';
import { ContextConfig } from '../types/models';
import { truncate } from '../utils/text';
import { RetrievalResult } from './retrieval';

export interface BuiltContext {
  text: string;
  usedFiles: string[];
}

export function buildContext(
  retrieval: RetrievalResult,
  indexer: ICodeIndexer,
  graph: IProjectGraph,
  config: ContextConfig
): BuiltContext {
  const index = indexer.getIndex();
  if (!index || !retrieval.confident) return { text: '', usedFiles: [] };

  const sections: string[] = [];
  const usedFiles: string[] = [];
  let totalChars = 0;

  const allowedFiles = new Set<string>(retrieval.files.map((f) => f.path));
  for (const entry of retrieval.knowledge) {
    for (const filePath of entry.filePaths) {
      if (index.files.some((f) => f.path === filePath)) {
        allowedFiles.add(filePath);
      }
    }
  }
  sections.push(
    `## Дозволені файли\n` +
    `У репозиторії ${index.stats.totalFiles} файлів. Нижче — єдині файли, релевантні до питання. ` +
    `Інших файлів у контексті немає; не згадуй файли поза цим списком та списком дозволених:\n` +
    [...allowedFiles].map((p) => `- ${p}`).join('\n')
  );

  for (const ranked of retrieval.files) {
    if (totalChars >= config.maxTotalChars) break;
    const file = index.files.find((f) => f.path === ranked.path);
    if (!file) continue;
    const content = indexer.readFile(ranked.path);
    if (content === null) continue;

    let excerpt: string;
    const anchorLine = retrieval.matchLines.get(ranked.path);
    if (anchorLine !== undefined) {
      const lines = content.split('\n');
      const start = Math.max(0, anchorLine - 30);
      excerpt = lines.slice(start, start + 120).join('\n');
      if (start > 0) excerpt = `…[рядки 1-${start} пропущено]\n${excerpt}`;
    } else {
      excerpt = content;
    }
    const budget = Math.min(config.maxCharsPerFile, config.maxTotalChars - totalChars);
    excerpt = truncate(excerpt, budget);
    totalChars += excerpt.length;

    const symbolList = file.symbols
      .slice(0, 12)
      .map((s) => `${s.kind} ${s.name} (рядок ${s.line})`)
      .join(', ');
    sections.push(
      `### Файл: ${ranked.path}\n` +
      `Мова: ${file.language}, рядків: ${file.lines}.\n` +
      (symbolList ? `Символи: ${symbolList}.\n` : '') +
      `Вміст:\n\`\`\`\n${excerpt}\n\`\`\``
    );
    usedFiles.push(ranked.path);
  }

  if (retrieval.knowledge.length > 0) {
    const knowledgeText = retrieval.knowledge
      .map((entry) => `### ${entry.topic}\n${truncate(entry.content, 1200)}`)
      .join('\n\n');
    sections.push(`## Знання про проєкт (з бази знань)\n${knowledgeText}`);
  }

  const graphLines: string[] = [];
  for (const filePath of usedFiles.slice(0, 4)) {
    const analysis = graph.analyzeModule(filePath);
    if (!analysis.found) continue;
    const imports = analysis.imports.map((i) => i.path).slice(0, 8);
    const importedBy = analysis.importedBy.map((i) => i.path).slice(0, 8);
    graphLines.push(
      `- ${filePath}: імпортує [${imports.join(', ') || '—'}]; ` +
      `імпортується в [${importedBy.join(', ') || '—'}]` +
      (analysis.isEntryPoint ? '; точка входу' : '')
    );
  }
  if (graphLines.length > 0) {
    sections.push(`## Зв'язки між файлами\n${graphLines.join('\n')}`);
  }

  return { text: sections.join('\n\n'), usedFiles };
}