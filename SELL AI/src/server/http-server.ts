import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import { patchConfigFile } from '../config/config';
import { OllamaProvider } from '../llm-adapter/ollama-provider';
import { Services } from '../runtime';
import { MemoryEventType, SellAiConfig } from '../types/models';
import { createGithubWebhookHandler } from './github-webhook';
import { SessionManager } from './session-manager';

const MAX_BODY_BYTES = 1_000_000;
const USER_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function statusForError(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes('ollama') && (lower.includes('недоступна') || lower.includes('не вдалося'))) {
    return 503;
  }
  if (lower.includes('не знайдено')) return 404;
  if (lower.includes('невалідний') || lower.includes('вкажи') || lower.includes('завелике')) {
    return 400;
  }
  return 500;
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Тіло запиту завелике (ліміт 1 МБ)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new Error('Невалідний JSON: очікується об\'єкт'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error('Невалідний JSON у тілі запиту'));
      }
    });
    req.on('error', reject);
  });
}

function authorized(req: http.IncomingMessage, token: string): boolean {
  if (!token) return true;
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = crypto.createHash('sha256').update(match[1]).digest();
  const expected = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(provided, expected);
}

function stringParam(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function startServer(config: SellAiConfig, baseDir: string): void {
  const sessions = new SessionManager(config, baseDir);
  const healthProvider = new OllamaProvider(config.ollama);
  const { host, port, authToken, corsOrigin } = config.server;

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-User-Id',
  };

  const webhookHandler = createGithubWebhookHandler(config, sessions, corsHeaders);

  const sendJson = (res: http.ServerResponse, status: number, data: unknown): void => {
    const payload = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders });
    res.end(payload);
  };

  const handleApi = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    services: Services
  ): Promise<void> => {
    const { core, llm, indexer, graph, knowledge, memory } = services;
    const route = `${req.method} ${url.pathname}`;
    const query = url.searchParams;

    switch (route) {
      case 'GET /api/status':
        sendJson(res, 200, await core.status());
        return;

      case 'POST /api/scan': {
        const { snapshot, changes } = await core.scanRepository();
        const graphData = graph.getGraph();
        sendJson(res, 200, {
          stats: snapshot.stats,
          changes,
          graph: graphData
            ? {
                nodes: graphData.nodes.length,
                edges: graphData.edges.length,
                entryPoints: graphData.entryPoints.length,
                cycles: graphData.cycles.length,
              }
            : null,
        });
        return;
      }

      case 'POST /api/ask': {
        const body = await readBody(req);
        const question = stringParam(body.question);
        if (!question) {
          sendJson(res, 400, { error: 'Вкажи поле "question" у тілі запиту' });
          return;
        }
        if (body.stream === true) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            ...corsHeaders,
          });
          const send = (obj: unknown): void => {
            res.write(`data: ${JSON.stringify(obj)}\n\n`);
          };
          try {
            const result = await core.ask(question, (token) => {
              send({ type: 'token', token });
            });
            send({ type: 'result', result });
          } catch (err) {
            send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
          }
          res.end();
          return;
        }
        const result = await core.ask(question);
        sendJson(res, 200, result);
        return;
      }

      case 'GET /api/files': {
        const q = stringParam(query.get('q'));
        if (!q) {
          sendJson(res, 400, { error: 'Вкажи параметр q' });
          return;
        }
        const limit = Number.parseInt(query.get('limit') ?? '10', 10);
        sendJson(res, 200, { matches: core.findFiles(q, Number.isNaN(limit) ? 10 : limit) });
        return;
      }

      case 'GET /api/search': {
        const q = stringParam(query.get('q'));
        if (!q) {
          sendJson(res, 400, { error: 'Вкажи параметр q' });
          return;
        }
        sendJson(res, 200, { matches: indexer.searchContent(q, 40) });
        return;
      }

      case 'GET /api/entry':
        sendJson(res, 200, { entryPoints: core.getEntryPoints() });
        return;

      case 'GET /api/graph': {
        const graphData = graph.getGraph();
        if (!graphData) {
          sendJson(res, 404, { error: 'Граф відсутній. Виконай POST /api/scan' });
          return;
        }
        const filePath = stringParam(query.get('path'));
        if (filePath) {
          sendJson(res, 200, {
            path: filePath,
            out: graph.getNeighbors(filePath, 'out'),
            in: graph.getNeighbors(filePath, 'in'),
          });
          return;
        }
        sendJson(res, 200, graphData);
        return;
      }

      case 'GET /api/module': {
        const filePath = stringParam(query.get('path'));
        if (!filePath) {
          sendJson(res, 400, { error: 'Вкажи параметр path' });
          return;
        }
        const analysis = core.analyzeRelations(filePath);
        if (!analysis.found) {
          sendJson(res, 404, { error: `Файл "${filePath}" не знайдено в графі` });
          return;
        }
        sendJson(res, 200, analysis);
        return;
      }

      case 'GET /api/path': {
        const from = stringParam(query.get('from'));
        const to = stringParam(query.get('to'));
        if (!from || !to) {
          sendJson(res, 400, { error: 'Вкажи параметри from і to' });
          return;
        }
        const chain = graph.findPath(from, to);
        if (!chain) {
          sendJson(res, 404, { error: 'Ланцюжок залежностей не знайдено' });
          return;
        }
        sendJson(res, 200, { path: chain });
        return;
      }

      case 'GET /api/knowledge': {
        const q = stringParam(query.get('q'));
        sendJson(res, 200, { entries: q ? knowledge.search(q, 8) : knowledge.all() });
        return;
      }

      case 'POST /api/knowledge': {
        const body = await readBody(req);
        const text = stringParam(body.text);
        if (!text) {
          sendJson(res, 400, { error: 'Вкажи поле "text" у тілі запиту' });
          return;
        }
        sendJson(res, 200, core.addNote(text));
        return;
      }

      case 'POST /api/summarize': {
        const body = await readBody(req);
        const filePath = stringParam(body.path);
        if (!filePath) {
          sendJson(res, 400, { error: 'Вкажи поле "path" у тілі запиту' });
          return;
        }
        sendJson(res, 200, await core.summarizeFile(filePath));
        return;
      }

      case 'GET /api/history': {
        const limit = Number.parseInt(query.get('limit') ?? '20', 10);
        const type = stringParam(query.get('type')) as MemoryEventType | null;
        sendJson(res, 200, { events: memory.getEvents(Number.isNaN(limit) ? 20 : limit, type ?? undefined) });
        return;
      }

      case 'GET /api/timeline':
        sendJson(res, 200, { days: memory.getTimeline() });
        return;

      case 'GET /api/models':
        sendJson(res, 200, { models: await llm.listModels(), current: llm.getModel() });
        return;

      case 'POST /api/model': {
        const body = await readBody(req);
        const model = stringParam(body.model);
        if (!model) {
          sendJson(res, 400, { error: 'Вкажи поле "model" у тілі запиту' });
          return;
        }
        const previous = llm.getModel();
        llm.setModel(model);
        patchConfigFile(services.baseDir, { model });
        memory.record('model-change', `Модель перемкнено через API: ${previous} → ${model}`, {
          from: previous,
          to: model,
        });
        const ready = await llm.ensureReady();
        sendJson(res, 200, {
          model: ready.model,
          available: ready.available,
          switched: ready.switched,
          models: ready.models.map((m) => m.name),
        });
        return;
      }

      case 'GET /api/repo':
        sendJson(res, 200, {
          repoPath: services.config.repoPath,
          exists: fs.existsSync(services.config.repoPath),
        });
        return;

      case 'POST /api/repo': {
        const body = await readBody(req);
        const repoPath = stringParam(body.path);
        if (!repoPath) {
          sendJson(res, 400, { error: 'Вкажи поле "path" у тілі запиту (абсолютний шлях на сервері)' });
          return;
        }
        core.setRepoPath(repoPath);
        sendJson(res, 200, {
          repoPath: services.config.repoPath,
          exists: fs.existsSync(services.config.repoPath),
        });
        return;
      }

      case 'DELETE /api/chat':
        memory.clearChat();
        sendJson(res, 200, { ok: true });
        return;

      default:
        sendJson(res, 404, { error: `Невідомий маршрут: ${route}` });
    }
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (url.pathname === '/webhooks/github') {
      webhookHandler(req, res);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/api/health') {
      void (async () => {
        const ollamaAvailable = await healthProvider.isAvailable();
        sendJson(res, 200, {
          name: 'SELL AI',
          mode: 'server',
          status: 'ok',
          ollama: ollamaAvailable ? 'available' : 'unavailable',
          auth: authToken ? 'bearer-token' : 'none',
          endpoints: [
            'GET /api/health', 'GET /api/status', 'POST /api/scan', 'POST /api/ask',
            'GET /api/files?q=', 'GET /api/search?q=', 'GET /api/entry', 'GET /api/graph',
            'GET /api/module?path=', 'GET /api/path?from=&to=', 'GET /api/knowledge',
            'POST /api/knowledge', 'POST /api/summarize', 'GET /api/history', 'GET /api/timeline',
            'GET /api/models', 'POST /api/model', 'GET /api/repo', 'POST /api/repo', 'DELETE /api/chat',
            'POST /webhooks/github',
          ],
        });
      })();
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Невідомий маршрут. Доступні маршрути: GET /api/health' });
      return;
    }

    if (!authorized(req, authToken)) {
      sendJson(res, 401, { error: 'Неавторизовано. Додай заголовок Authorization: Bearer <token>' });
      return;
    }

    const rawUserId = req.headers['x-user-id'];
    const userId =
      typeof rawUserId === 'string' && USER_ID_REGEX.test(rawUserId) ? rawUserId : 'default';

    void (async () => {
      try {
        const services = await sessions.get(userId);
        await handleApi(req, res, url, services);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) {
          sendJson(res, statusForError(message), { error: message });
        } else {
          res.end();
        }
      }
    })();
  });

  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 5_000;

  server.listen(port, host, () => {
    process.stdout.write('SELL AI — Server Mode\n');
    process.stdout.write(`Адреса: http://${host}:${port}\n`);
    process.stdout.write(`Автентифікація: ${authToken ? 'Bearer-токен увімкнено' : 'вимкнено'}\n`);
    process.stdout.write(`Дані користувачів: ${config.dataDir}/users/<X-User-Id>\n`);
    process.stdout.write(`Репозиторій за замовчуванням: ${config.repoPath}\n`);
    process.stdout.write(`Ollama: ${config.ollama.baseUrl}\n`);
    if (!authToken && host !== '127.0.0.1' && host !== 'localhost') {
      process.stdout.write(
        'УВАГА: сервер слухає зовнішній інтерфейс без токена. Задай SELLAI_TOKEN для віддаленого доступу.\n'
      );
    }
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}