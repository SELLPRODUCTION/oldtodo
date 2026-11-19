# SELL AI

Локальна AI-підсистема SELLDEV. Працює на ПК розробника через Ollama, без серверів.

## Запуск

```bash
npm install
npm run build
npm start
```

Потрібно: Node.js >= 18.17, запущена Ollama (`ollama serve`) і хоча б одна модель
(`ollama pull qwen2.5:7b` або `ollama pull deepseek-r1:7b`, `ollama pull mistral`).

## Налаштування

У `sellai.config.json`:

- `repoPath` — шлях до локальної копії репозиторію SELLDEV (за замовчуванням `../SELLDEV`).
- `ollama.model` — модель за замовчуванням; якщо її немає в Ollama, система автоматично
  обере доступну (Qwen → DeepSeek → Mistral → інша) і продовжить працювати.
- `ollama.baseUrl` — адреса Ollama (за замовчуванням `http://127.0.0.1:11434`).

Змінні середовища: `SELLAI_REPO`, `SELLAI_MODEL`, `OLLAMA_HOST`, `SELLAI_DATA_DIR`.

## Використання

Інтерактивний режим: `npm start`, далі команди (`help` — довідка):

```
scan
ask де реалізовано авторизацію?
find payment
entry
relate src/services/auth.ts
```

Одноразові команди: `npm start -- scan`, `npm start -- ask "які точки входу?"`.

Дані (індекс, граф, знання, пам'ять) зберігаються локально в `.sellai-data/`.

## Режими роботи

Перемикання — через конфігурацію, без зміни коду. Однакові модулі в обох режимах.

### Local Mode (за замовчуванням)

`"mode": "local"` у `sellai.config.json` → CLI + локальна Ollama + локальний репозиторій.

### Server Mode

`"mode": "server"` або `npm run server` / `node dist/index.js --server` → HTTP API.

Налаштування (`sellai.config.json` → `server` або змінні середовища):

| Поле | Змінна | За замовчуванням | Призначення |
|---|---|---|---|
| `server.host` | `SELLAI_HOST` | `127.0.0.1` | `0.0.0.0` для VPS/віддаленого доступу |
| `server.port` | `SELLAI_PORT` | `8787` | порт HTTP |
| `server.authToken` | `SELLAI_TOKEN` | порожньо | Bearer-токен (обов'язковий для віддаленого доступу) |
| `server.corsOrigin` | `SELLAI_CORS_ORIGIN` | `*` | дозволений origin для браузера |
| `server.githubWebhookSecret` | `SELLAI_GITHUB_SECRET` | порожньо | секрет GitHub webhook (HMAC SHA-256) |
| `server.webhookUserId` | `SELLAI_WEBHOOK_USER` | `default` | сесія, чий репозиторій синхронізує webhook |

Кожен користувач ізолюється заголовком `X-User-Id` (латиниця, цифри, `_`, `-`;
за замовчуванням `default`). Дані користувача: `.sellai-data/users/<id>/`
(власні індекс, граф, знання, пам'ять, модель, репозиторій).

`repoPath` і модель перечитуються з конфігурації при кожному запиті — зміни
застосовуються без перезапуску сервера. Пріоритет: змінна середовища
(`SELLAI_REPO`/`SELLAI_MODEL`) → конфіг сесії `.sellai-data/users/<id>/sellai.config.json`
(зберігається при `POST /api/repo` і `POST /api/model`) → кореневий `sellai.config.json`.

Приклади:

```bash
curl http://127.0.0.1:8787/api/health
curl -H "Authorization: Bearer $TOKEN" -H "X-User-Id: dev1" http://127.0.0.1:8787/api/status
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"які точки входу?"}' http://127.0.0.1:8787/api/ask
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"які модулі?","stream":true}' http://127.0.0.1:8787/api/ask   # SSE
```

Основні маршрути: `POST /api/scan`, `POST /api/ask` (JSON або SSE через `stream:true`),
`GET /api/files?q=`, `GET /api/entry`, `GET /api/graph`, `GET /api/module?path=`,
`GET /api/knowledge`, `GET /api/history`, `GET /api/timeline`, `GET /api/models`,
`POST /api/model`, `GET/POST /api/repo`, `DELETE /api/chat`. Повний список — `GET /api/health`.

### GitHub Webhook

`POST /webhooks/github` — автоматична синхронізація після змін у GitHub.
Працює в Server Mode; Bearer-токен не потрібен (автентифікація — підпис GitHub).

Пайплайн при `push` або merged `pull_request`:

1. `git pull --ff-only` у репозиторії сесії `webhookUserId`
2. сканування (інкрементальний індекс)
3. оновлення графа проєкту
4. оновлення бази знань
5. запис події `webhook` у пам'ять (timeline)

Інші сесії з тим самим `repoPath` синхронізуються теж. Паралельні webhook
для одного репозиторію не запускають другий pipeline — запит ставиться в чергу
(відповідь `202 queued`) і виконується одним повторним проходом.

Підтримувані події (`X-GitHub-Event`):

| Подія | Дія | Відповідь |
|---|---|---|
| `push` | повний pipeline | `200` з результатами pull/scan |
| `pull_request` (`closed` + `merged:true`) | повний pipeline (merge) | `200` |
| `pull_request` (інші дії) | запис у пам'ять | `202 handled:false` |
| `ping` | перевірка з'єднання | `200 pong:true` |
| інші | ігнорується | `202 handled:false` |

Налаштування в GitHub: Settings → Webhooks → Add webhook:
- Payload URL: `https://<твій-хост>/webhooks/github`
- Content type: `application/json`
- Secret: той самий, що в `SELLAI_GITHUB_SECRET`
- Events: "Just the push event" + "Pull requests"

Якщо `SELLAI_GITHUB_SECRET` порожній — підпис не перевіряється (лише для локальних
тестів; для віддаленого доступу секрет обов'язковий). Невалідний підпис → `401`.
Якщо `git pull` не вдався (конфлікт, немає мережі) — pipeline все одно сканує
поточний стан, помилка pull повертається у відповіді та пишеться в пам'ять.

Перевірка локально:

```bash
BODY='{"ref":"refs/heads/main","commits":[],"pusher":{"name":"dev"}}'
SIG=$(node -e "const c=require('crypto');console.log('sha256='+c.createHmac('sha256',process.env.SELLAI_GITHUB_SECRET).update(process.argv[1]).digest('hex'))" "$BODY")
curl -X POST http://127.0.0.1:8787/webhooks/github \
  -H "Content-Type: application/json" -H "X-GitHub-Event: push" \
  -H "X-Hub-Signature-256: $SIG" -d "$BODY"
```

### Підготовка до VPS

Система готова до перенесення без змін коду:

1. Скопіюй папку SELL AI на сервер, встанови Node.js >= 18.17 і Ollama (`ollama serve`).
2. Задай змінні: `SELLAI_MODE=server`, `SELLAI_HOST=0.0.0.0`, `SELLAI_TOKEN=<секрет>`,
   `SELLAI_REPO=/шлях/до/SELLDEV`, `OLLAMA_HOST=127.0.0.1:11434` (або інший хост Ollama).
3. `npm install && npm run build && npm start`.
4. Для продакшену — HTTPS через reverse-proxy (nginx/caddy); SSE підтримується
   (`X-Accel-Buffering: no` вже встановлено). Процес можна тримати через systemd/pm2.