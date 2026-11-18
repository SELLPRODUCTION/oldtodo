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