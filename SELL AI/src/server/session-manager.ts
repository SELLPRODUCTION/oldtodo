import * as fs from 'fs';
import * as path from 'path';
import { createServices, Services } from '../runtime';
import { SellAiConfig } from '../types/models';

export class SessionManager {
  private readonly sessions = new Map<string, Promise<Services>>();

  constructor(
    private readonly config: SellAiConfig,
    private readonly baseDir: string
  ) {}

  get(userId: string): Promise<Services> {
    let session = this.sessions.get(userId);
    if (!session) {
      session = this.create(userId);
      this.sessions.set(userId, session);
      session.catch(() => {
        this.sessions.delete(userId);
      });
    }
    return session.then((services) => {
      this.refresh(services);
      return services;
    });
  }

  list(): { userId: string; session: Promise<Services> }[] {
    return [...this.sessions.entries()].map(([userId, session]) => ({ userId, session }));
  }

  private readSaved(file: string): { repoPath?: string; model?: string } {
    if (!fs.existsSync(file)) return {};
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
        repoPath?: unknown;
        ollama?: { model?: unknown };
      };
      return {
        repoPath: typeof saved.repoPath === 'string' ? saved.repoPath : undefined,
        model: saved.ollama && typeof saved.ollama.model === 'string' ? saved.ollama.model : undefined,
      };
    } catch {
      return {};
    }
  }

  private refresh(services: Services): void {
    const userDir = services.baseDir;
    const userSaved = this.readSaved(path.join(userDir, 'sellai.config.json'));
    const rootSaved = this.readSaved(path.join(this.baseDir, 'sellai.config.json'));

    let repoPath: string | undefined;
    if (process.env.SELLAI_REPO) {
      repoPath = path.resolve(this.baseDir, process.env.SELLAI_REPO);
    } else if (userSaved.repoPath !== undefined) {
      repoPath = path.resolve(userDir, userSaved.repoPath);
    } else if (rootSaved.repoPath !== undefined) {
      repoPath = path.resolve(this.baseDir, rootSaved.repoPath);
    }
    if (repoPath && repoPath !== services.config.repoPath) {
      const old = services.config.repoPath;
      services.config.repoPath = repoPath;
      services.memory.record(
        'repo-change',
        `Репозиторій оновлено з конфігурації: ${old} → ${repoPath}`,
        { old, new: repoPath, source: 'config-reload' }
      );
    }

    const model = process.env.SELLAI_MODEL ?? userSaved.model ?? rootSaved.model;
    if (model && model !== services.llm.getModel()) {
      services.llm.setModel(model);
    }
  }

  private async create(userId: string): Promise<Services> {
    const userDir = path.join(this.config.dataDir, 'users', userId);
    fs.mkdirSync(userDir, { recursive: true });

    const userConfig: SellAiConfig = {
      ...this.config,
      dataDir: userDir,
      ollama: { ...this.config.ollama },
      indexer: {
        ...this.config.indexer,
        excludeDirs: [...this.config.indexer.excludeDirs],
        includeExtensions: [...this.config.indexer.includeExtensions],
      },
      context: { ...this.config.context },
      server: { ...this.config.server },
    };

    const userConfigFile = path.join(userDir, 'sellai.config.json');
    const saved = this.readSaved(userConfigFile);
    if (saved.repoPath !== undefined) {
      userConfig.repoPath = path.resolve(userDir, saved.repoPath);
    }
    if (saved.model !== undefined) {
      userConfig.ollama.model = saved.model;
    }

    const services = createServices(userConfig, userDir);
    await services.core.initialize();
    return services;
  }
}