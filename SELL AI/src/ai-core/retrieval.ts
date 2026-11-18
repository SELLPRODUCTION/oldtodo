import { ICodeIndexer, IKnowledgeBase } from '../types/contracts';
import { ContextConfig, KnowledgeEntry } from '../types/models';
import { tokenize } from '../utils/text';

export interface RankedFile {
  path: string;
  score: number;
  coverage: number;
  matchedTokens: string[];
}

export interface RetrievalResult {
  files: RankedFile[];
  knowledge: KnowledgeEntry[];
  matchLines: Map<string, number>;
  confident: boolean;
}

const MIN_SCORE = 6;
const MIN_COVERAGE = 0.2;

interface FileScore {
  score: number;
  matched: Set<string>;
}

export function retrieve(
  question: string,
  indexer: ICodeIndexer,
  knowledge: IKnowledgeBase,
  config: ContextConfig
): RetrievalResult {
  const empty: RetrievalResult = {
    files: [],
    knowledge: [],
    matchLines: new Map(),
    confident: false,
  };
  const index = indexer.getIndex();
  if (!index) return empty;
  const tokens = tokenize(question);
  if (tokens.length === 0) return empty;

  const scores = new Map<string, FileScore>();
  const hit = (filePath: string, value: number, token: string): void => {
    const entry = scores.get(filePath) ?? { score: 0, matched: new Set<string>() };
    entry.score += value;
    entry.matched.add(token);
    scores.set(filePath, entry);
  };

  for (const file of index.files) {
    const pathLower = file.path.toLowerCase();
    for (const token of tokens) {
      if (pathLower.includes(token)) {
        hit(file.path, 3, token);
      }
    }
    let symbolScore = 0;
    for (const symbol of file.symbols) {
      const symbolLower = symbol.name.toLowerCase();
      for (const token of tokens) {
        if (symbolLower.includes(token)) {
          symbolScore += 4;
          hit(file.path, 4, token);
          break;
        }
      }
      if (symbolScore >= 16) break;
    }
  }

  const matchLines = new Map<string, number>();
  const latinTokens = tokens.filter((t) => /^[a-z0-9_]+$/.test(t));
  const otherTokens = tokens.filter((t) => !/^[a-z0-9_]+$/.test(t));
  const contentQueries: { query: string; token: string; weight: number }[] = [
    { query: question.trim(), token: question.trim(), weight: 4 },
    ...latinTokens.slice(0, 5).map((t) => ({ query: t, token: t, weight: 2 })),
    ...otherTokens.slice(0, 2).map((t) => ({ query: t, token: t, weight: 2 })),
  ].filter((q) => q.query.length >= 3);

  for (const { query, token, weight } of contentQueries) {
    const matches = indexer.searchContent(query, 20);
    for (const match of matches) {
      hit(match.path, weight, token);
      if (!matchLines.has(match.path)) {
        matchLines.set(match.path, match.line);
      }
    }
  }

  const knowledgeEntries = knowledge.search(question, 3);
  for (const entry of knowledgeEntries) {
    for (const filePath of entry.filePaths) {
      if (scores.has(filePath) || index.files.some((f) => f.path === filePath)) {
        hit(filePath, 3, 'knowledge');
      }
    }
  }

  const ranked: RankedFile[] = [...scores.entries()]
    .map(([filePath, entry]) => ({
      path: filePath,
      score: entry.score,
      coverage: entry.matched.size / tokens.length,
      matchedTokens: [...entry.matched],
    }))
    .sort((a, b) => b.score + b.coverage * 10 - (a.score + a.coverage * 10));

  const top = ranked[0];
  const filesConfident =
    top !== undefined && top.score >= MIN_SCORE && top.coverage >= MIN_COVERAGE;
  const confident = filesConfident || knowledgeEntries.length > 0;

  return {
    files: confident ? ranked.slice(0, config.maxFiles) : [],
    knowledge: knowledgeEntries,
    matchLines,
    confident,
  };
}