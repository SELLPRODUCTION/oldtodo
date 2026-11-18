import { IModelProvider } from '../types/contracts';
import {
  ChatMessage,
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  OllamaConfig,
} from '../types/models';

interface OllamaTagsResponse {
  models?: {
    name: string;
    size?: number;
    details?: { family?: string; parameter_size?: string };
    modified_at?: string;
  }[];
}

interface OllamaChatChunk {
  model?: string;
  message?: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  error?: string;
}

export class OllamaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaError';
  }
}

export class OllamaProvider implements IModelProvider {
  readonly name = 'ollama';

  constructor(private readonly config: OllamaConfig) {}

  private url(endpoint: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, '')}${endpoint}`;
  }

  private async fetchJson<T>(
    endpoint: string,
    init: RequestInit | undefined,
    timeoutMs: number
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.url(endpoint), { ...init, signal: controller.signal });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new OllamaError(`Ollama повернула HTTP ${response.status}: ${body.slice(0, 300)}`);
      }
      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof OllamaError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new OllamaError(
        `Не вдалося звернутися до Ollama за адресою ${this.config.baseUrl}. ` +
        `Переконайся, що Ollama запущена (ollama serve). Деталі: ${reason}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.fetchJson<OllamaTagsResponse>('/api/tags', undefined, 5000);
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const data = await this.fetchJson<OllamaTagsResponse>('/api/tags', undefined, 10000);
    return (data.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size ?? 0,
      family: m.details?.family ?? '',
      parameterSize: m.details?.parameter_size ?? '',
      modifiedAt: m.modified_at ?? '',
    }));
  }

  private buildBody(
    messages: ChatMessage[],
    options: GenerateOptions | undefined,
    stream: boolean
  ): Record<string, unknown> {
    return {
      model: options?.model ?? this.config.model,
      messages,
      stream,
      options: {
        temperature: options?.temperature ?? this.config.temperature,
        num_ctx: options?.numCtx ?? this.config.numCtx,
        num_predict: options?.maxTokens ?? this.config.maxTokens,
      },
    };
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  async chat(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult> {
    const data = await this.fetchJson<OllamaChatChunk>(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildBody(messages, options, false)),
      },
      this.config.timeoutMs
    );
    if (data.error) {
      throw new OllamaError(`Ollama: ${data.error}`);
    }
    return {
      text: data.message?.content ?? '',
      model: data.model ?? options?.model ?? this.config.model,
      done: data.done ?? true,
      totalDurationMs: Math.round((data.total_duration ?? 0) / 1e6),
      tokensGenerated: data.eval_count ?? 0,
    };
  }

  async streamChat(
    messages: ChatMessage[],
    options: GenerateOptions | undefined,
    onToken: (token: string) => void
  ): Promise<GenerateResult> {
    const controller = new AbortController();
    let idleTimer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const resetIdle = (): void => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    };
    try {
      const response = await fetch(this.url('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildBody(messages, options, true)),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '');
        throw new OllamaError(`Ollama повернула HTTP ${response.status}: ${body.slice(0, 300)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let model = options?.model ?? this.config.model;
      let totalDurationMs = 0;
      let tokensGenerated = 0;
      let done = false;
      for (;;) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        resetIdle();
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;
          let chunk: OllamaChatChunk;
          try {
            chunk = JSON.parse(line) as OllamaChatChunk;
          } catch {
            continue;
          }
          if (chunk.error) {
            throw new OllamaError(`Ollama: ${chunk.error}`);
          }
          const piece = chunk.message?.content ?? '';
          if (piece) {
            text += piece;
            onToken(piece);
          }
          if (chunk.model) model = chunk.model;
          if (chunk.done) {
            done = true;
            totalDurationMs = Math.round((chunk.total_duration ?? 0) / 1e6);
            tokensGenerated = chunk.eval_count ?? 0;
          }
        }
      }
      return { text, model, done, totalDurationMs, tokensGenerated };
    } catch (err) {
      if (err instanceof OllamaError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new OllamaError(`Помилка потокової генерації Ollama: ${reason}`);
    } finally {
      clearTimeout(idleTimer);
    }
  }
}