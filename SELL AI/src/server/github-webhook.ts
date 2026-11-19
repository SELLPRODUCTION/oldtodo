import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import { promisify } from 'util';
import { Services } from '../runtime';
import { SellAiConfig } from '../types/models';
import { SessionManager } from './session-manager';

const execFileAsync = promisify(execFile);
const MAX_BODY_BYTES = 5_000_000;
const GIT_TIMEOUT_MS = 120_000;

interface PullResult {
  pulled: boolean;
  before: string | null;
  after: string | null;
  output: string;
  error?: string;
}

interface SessionSyncResult {
  userId: string;
  totalFiles: number;
  added: number;
  changed: number;
  removed: number;
  graphNodes: number;
  graphEdges: number;
  knowledgeEntries: number;
}

interface SyncOutcome {
  pull: PullResult;
  synced: SessionSyncResult[];
}

interface WebhookMeta {
  event: string;
  action?: string;
  ref?: string;
  commits?: number;
  pusher?: string;
  delivery?: string;
  prNumber?: number;
  prTitle?: string;
  merged?: boolean;
}

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Тіло webhook завелике (ліміт 5 МБ)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const provided = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  return provided.length === expectedBuf.length && crypto.timingSafeEqual(provided, expectedBuf);
}

async function gitHead(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], {
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function gitPull(repoPath: string): Promise<PullResult> {
  const before = await gitHead(repoPath);
  try {
    const { stdout, stderr } = await execFileAsync(
      'git',
      ['-C', repoPath, 'pull', '--ff-only'],
      { timeout: GIT_TIMEOUT_MS, windowsHide: true }
    );
    const after = await gitHead(repoPath);
    return { pulled: true, before, after, output: `${stdout}${stderr}`.trim().slice(0, 500) };
  } catch (err) {
    const e = err as { message?: string; stderr?: string; stdout?: string };
    const after = await gitHead(repoPath);
    return {
      pulled: false,
      before,
      after,
      output: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().slice(0, 500),
      error: (e.message ?? String(err)).slice(0, 300),
    };
  }
}

function parseMeta(
  event: string,
  payload: Record<string, unknown>,
  delivery: string | undefined
): WebhookMeta {
  const meta: WebhookMeta = { event, delivery };
  if (event === 'push') {
    meta.ref = typeof payload.ref === 'string' ? payload.ref : undefined;
    meta.commits = Array.isArray(payload.commits) ? payload.commits.length : 0;
    meta.pusher = typeof payload.pusher === 'object' && payload.pusher !== null
      ? String((payload.pusher as Record<string, unknown>).name ?? '')
      : undefined;
  } else if (event === 'pull_request') {
    meta.action = typeof payload.action === 'string' ? payload.action : undefined;
    const pr = payload.pull_request;
    if (typeof pr === 'object' && pr !== null) {
      const prRecord = pr as Record<string, unknown>;
      meta.prNumber = typeof prRecord.number === 'number' ? prRecord.number : undefined;
      meta.prTitle = typeof prRecord.title === 'string' ? prRecord.title.slice(0, 200) : undefined;
      meta.merged = prRecord.merged === true;
      meta.ref = typeof prRecord.base === 'object' && prRecord.base !== null
        ? String((prRecord.base as Record<string, unknown>).ref ?? '')
        : undefined;
    }
  }
  return meta;
}

export function createGithubWebhookHandler(
  config: SellAiConfig,
  sessions: SessionManager,
  corsHeaders: Record<string, string>
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const secret = config.server.githubWebhookSecret;
  const locks = new Map<string, Promise<SyncOutcome>>();
  const pending = new Set<string>();
  let secretWarningShown = false;

  const sendJson = (res: http.ServerResponse, status: number, data: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders });
    res.end(JSON.stringify(data));
  };

  const collectTargets = async (repoPath: string): Promise<{ userId: string; services: Services }[]> => {
    const primary = await sessions.get(config.server.webhookUserId);
    const targets: { userId: string; services: Services }[] = [
      { userId: config.server.webhookUserId, services: primary },
    ];
    for (const { userId } of sessions.list()) {
      if (userId === config.server.webhookUserId) continue;
      try {
        const services = await sessions.get(userId);
        if (services.config.repoPath === repoPath) {
          targets.push({ userId, services });
        }
      } catch {
        // сесія не ініціалізувалась — пропускаємо
      }
    }
    return targets;
  };

  const runSync = async (repoPath: string, meta: WebhookMeta): Promise<SyncOutcome> => {
    const pull = await gitPull(repoPath);
    const targets = await collectTargets(repoPath);
    const synced: SessionSyncResult[] = [];
    for (const { userId, services } of targets) {
      services.memory.record(
        'webhook',
        `GitHub ${meta.event}${meta.action ? `/${meta.action}` : ''}: git pull ${pull.pulled ? 'виконано' : 'не вдався'} → сканування`,
        { ...meta, pull }
      );
      const { snapshot, changes } = await services.core.scanRepository();
      const graph = services.graph.getGraph();
      synced.push({
        userId,
        totalFiles: snapshot.stats.totalFiles,
        added: changes.added.length,
        changed: changes.changed.length,
        removed: changes.removed.length,
        graphNodes: graph?.nodes.length ?? 0,
        graphEdges: graph?.edges.length ?? 0,
        knowledgeEntries: services.knowledge.all().length,
      });
    }
    return { pull, synced };
  };

  const runLocked = async (repoPath: string, meta: WebhookMeta): Promise<SyncOutcome> => {
    const task = (async (): Promise<SyncOutcome> => {
      let outcome: SyncOutcome;
      do {
        pending.delete(repoPath);
        outcome = await runSync(repoPath, meta);
      } while (pending.has(repoPath));
      return outcome;
    })();
    locks.set(repoPath, task);
    try {
      return await task;
    } finally {
      locks.delete(repoPath);
    }
  };

  return (req, res) => {
    void (async () => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Webhook приймає лише POST' });
        return;
      }
      const raw = await readRawBody(req);
      if (secret) {
        const signature = req.headers['x-hub-signature-256'];
        const header = typeof signature === 'string' ? signature : undefined;
        if (!verifySignature(raw, header, secret)) {
          sendJson(res, 401, { error: 'Невалідний підпис webhook (X-Hub-Signature-256)' });
          return;
        }
      } else if (!secretWarningShown) {
        secretWarningShown = true;
        process.stdout.write(
          'УВАГА: GitHub webhook працює без секрету. Задай SELLAI_GITHUB_SECRET для перевірки підпису.\n'
        );
      }

      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(raw.toString('utf-8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: 'Невалідний JSON payload' });
        return;
      }

      const eventHeader = req.headers['x-github-event'];
      const event = typeof eventHeader === 'string' ? eventHeader : '';
      const deliveryHeader = req.headers['x-github-delivery'];
      const delivery = typeof deliveryHeader === 'string' ? deliveryHeader : undefined;

      if (event === 'ping') {
        sendJson(res, 200, { ok: true, pong: true, zen: payload.zen ?? null });
        return;
      }

      const meta = parseMeta(event, payload, delivery);
      const isMerge = event === 'pull_request' && meta.action === 'closed' && meta.merged === true;
      const shouldSync = event === 'push' || isMerge;

      const primary = await sessions.get(config.server.webhookUserId);

      if (!shouldSync) {
        if (event === 'pull_request' || event === 'push') {
          primary.memory.record(
            'webhook',
            `GitHub ${event}${meta.action ? `/${meta.action}` : ''} зафіксовано без синхронізації` +
            (meta.prNumber ? ` (PR #${meta.prNumber})` : ''),
            { ...meta }
          );
        }
        sendJson(res, 202, {
          ok: true,
          handled: false,
          event,
          action: meta.action ?? null,
          reason:
            event === 'pull_request'
              ? 'Синхронізація виконується лише для push або merged pull_request'
              : `Подія "${event}" не підтримується`,
        });
        return;
      }

      const repoPath = primary.config.repoPath;
      if (!fs.existsSync(repoPath)) {
        primary.memory.record('error', `Webhook: репозиторій не знайдено: ${repoPath}`, { ...meta });
        sendJson(res, 500, {
          error:
            `Репозиторій не знайдено: ${repoPath}. ` +
            'Склонуй репозиторій у цей шлях або задай актуальний через POST /api/repo (застосовується без перезапуску)',
        });
        return;
      }

      if (locks.has(repoPath)) {
        pending.add(repoPath);
        sendJson(res, 202, { ok: true, queued: true, event, ref: meta.ref ?? null });
        return;
      }

      const startedAt = Date.now();
      try {
        const outcome = await runLocked(repoPath, meta);
        sendJson(res, 200, {
          ok: true,
          event: isMerge ? 'merge' : event,
          ref: meta.ref ?? null,
          pull: outcome.pull,
          synced: outcome.synced,
          durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        primary.memory.record('error', `Webhook sync помилка: ${message.slice(0, 300)}`, { ...meta });
        sendJson(res, 500, { error: message });
      }
    })().catch((err: unknown) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } else {
        res.end();
      }
    });
  };
}