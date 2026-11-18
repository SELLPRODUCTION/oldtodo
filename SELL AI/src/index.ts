import * as fs from 'fs';
import * as path from 'path';
import { AICore, AICoreDeps } from './ai-core/ai-core';
import { CLI } from './cli/cli';
import { CodeIndexer } from './code-indexer/code-indexer';
import { loadConfig, patchConfigFile } from './config/config';
import { KnowledgeBase } from './knowledge-base/knowledge-base';
import { LLMAdapter } from './llm-adapter/llm-adapter';
import { OllamaProvider } from './llm-adapter/ollama-provider';
import { MemorySystem } from './memory-system/memory-system';
import { ProjectGraph } from './project-graph/project-graph';
import {
  IndexSnapshot,
  KnowledgeEntry,
  MemoryData,
  ProjectGraphData,
} from './types/models';
import { JsonStore } from './utils/json-store';

async function main(): Promise<void> {
  const baseDir = path.resolve(__dirname, '..');
  const config = loadConfig(baseDir);
  fs.mkdirSync(config.dataDir, { recursive: true });

  const indexStore = new JsonStore<IndexSnapshot | null>(
    path.join(config.dataDir, 'index.json'),
    null
  );
  const graphStore = new JsonStore<ProjectGraphData | null>(
    path.join(config.dataDir, 'graph.json'),
    null
  );
  const knowledgeStore = new JsonStore<KnowledgeEntry[]>(
    path.join(config.dataDir, 'knowledge.json'),
    []
  );
  const memoryStore = new JsonStore<MemoryData>(
    path.join(config.dataDir, 'memory.json'),
    { events: [], chat: [] }
  );

  const memory = new MemorySystem(memoryStore);
  const provider = new OllamaProvider(config.ollama);
  const llm = new LLMAdapter(provider, config.ollama.model, (from, to, reason) => {
    memory.record('model-change', `Модель змінено автоматично: ${from} → ${to} (${reason})`, {
      from,
      to,
      reason,
    });
    patchConfigFile(baseDir, { model: to });
    process.stdout.write(`[LLM] Модель змінено: ${from} → ${to} (${reason})\n`);
  });
  const indexer = new CodeIndexer(config, indexStore);
  const graph = new ProjectGraph(graphStore);
  const knowledge = new KnowledgeBase(knowledgeStore);

  const deps: AICoreDeps = { config, baseDir, llm, indexer, graph, knowledge, memory };
  const core = new AICore(deps);
  await core.initialize();

  const cli = new CLI(deps, core);
  const args = process.argv.slice(2);
  if (args.length > 0) {
    await cli.runOnce(args);
    return;
  }
  cli.runInteractive();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Критична помилка SELL AI: ${message}\n`);
  process.exit(1);
});