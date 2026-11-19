import * as fs from 'fs';
import * as path from 'path';
import { SellAiConfig } from '../types/models';

export const DEFAULT_CONFIG: SellAiConfig = {
  mode: 'local',
  repoPath: '.',
  dataDir: '.sellai-data',
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5:7b',
    temperature: 0.2,
    numCtx: 8192,
    maxTokens: 2048,
    timeoutMs: 300000,
  },
  server: {
    host: '127.0.0.1',
    port: 8787,
    authToken: '',
    corsOrigin: '*',
    githubWebhookSecret: '',
    webhookUserId: 'default',
  },
  indexer: {
    maxFileSizeKb: 512,
    excludeDirs: [
      'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
      '.next', '.nuxt', 'vendor', '__pycache__', '.venv', 'venv',
      '.idea', '.vscode', 'bin', 'obj', 'target', '.sellai-data', '.cache', 'tmp',
    ],
    includeExtensions: [
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h', '.hpp',
      '.rb', '.php', '.html', '.css', '.scss', '.json', '.yaml', '.yml',
      '.md', '.sql', '.sh', '.bat', '.ps1', '.toml', '.ini', '.cfg', '.env.example',
    ],
  },
  context: {
    maxFiles: 6,
    maxCharsPerFile: 4000,
    maxTotalChars: 16000,
    chatHistoryTurns: 3,
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    result[key] = deepMerge(base[key], override[key]);
  }
  return result;
}

function normalizeOllamaHost(host: string): string {
  let url = host.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url.replace('0.0.0.0', '127.0.0.1').replace(/\/+$/, '');
}

export function configFilePath(baseDir: string): string {
  return path.join(baseDir, 'sellai.config.json');
}

export function loadConfig(baseDir: string): SellAiConfig {
  let fileConfig: unknown = {};
  const file = configFilePath(baseDir);
  if (fs.existsSync(file)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      fileConfig = {};
    }
  }
  const merged = deepMerge(DEFAULT_CONFIG, fileConfig) as SellAiConfig;

  if (process.env.SELLAI_REPO) merged.repoPath = process.env.SELLAI_REPO;
  if (process.env.SELLAI_MODEL) merged.ollama.model = process.env.SELLAI_MODEL;
  if (process.env.OLLAMA_HOST) merged.ollama.baseUrl = normalizeOllamaHost(process.env.OLLAMA_HOST);
  if (process.env.SELLAI_DATA_DIR) merged.dataDir = process.env.SELLAI_DATA_DIR;
  if (process.env.SELLAI_MODE === 'local' || process.env.SELLAI_MODE === 'server') {
    merged.mode = process.env.SELLAI_MODE;
  }
  if (process.env.SELLAI_HOST) merged.server.host = process.env.SELLAI_HOST;
  if (process.env.SELLAI_PORT) {
    const port = Number.parseInt(process.env.SELLAI_PORT, 10);
    if (!Number.isNaN(port) && port > 0 && port < 65536) merged.server.port = port;
  }
  if (process.env.SELLAI_TOKEN) merged.server.authToken = process.env.SELLAI_TOKEN;
  if (process.env.SELLAI_CORS_ORIGIN) merged.server.corsOrigin = process.env.SELLAI_CORS_ORIGIN;
  if (process.env.SELLAI_GITHUB_SECRET) merged.server.githubWebhookSecret = process.env.SELLAI_GITHUB_SECRET;
  if (process.env.SELLAI_WEBHOOK_USER) merged.server.webhookUserId = process.env.SELLAI_WEBHOOK_USER;

  if (merged.mode !== 'local' && merged.mode !== 'server') merged.mode = 'local';
  merged.repoPath = path.resolve(baseDir, merged.repoPath);
  merged.dataDir = path.resolve(baseDir, merged.dataDir);
  merged.ollama.baseUrl = normalizeOllamaHost(merged.ollama.baseUrl);
  return merged;
}

export function patchConfigFile(
  baseDir: string,
  patch: { repoPath?: string; model?: string }
): void {
  const file = configFilePath(baseDir);
  let current: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (isPlainObject(parsed)) current = parsed;
    } catch {
      current = {};
    }
  }
  if (patch.repoPath !== undefined) {
    current.repoPath = patch.repoPath;
  }
  if (patch.model !== undefined) {
    const ollama = isPlainObject(current.ollama) ? current.ollama : {};
    ollama.model = patch.model;
    current.ollama = ollama;
  }
  fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf-8');
}