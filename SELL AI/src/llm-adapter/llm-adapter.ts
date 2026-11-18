import { ILLMAdapter, IModelProvider } from '../types/contracts';
import {
  ChatMessage,
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ReadyState,
} from '../types/models';
import { OllamaError } from './ollama-provider';

export type ModelSwitchListener = (from: string, to: string, reason: string) => void;

export class LLMAdapter implements ILLMAdapter {
  private currentModel: string;

  constructor(
    private readonly provider: IModelProvider,
    initialModel: string,
    private readonly onModelSwitch?: ModelSwitchListener
  ) {
    this.currentModel = initialModel;
  }

  getProvider(): IModelProvider {
    return this.provider;
  }

  getModel(): string {
    return this.currentModel;
  }

  setModel(model: string): void {
    this.currentModel = model;
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.provider.listModels();
  }

  async ensureReady(): Promise<ReadyState> {
    const available = await this.provider.isAvailable();
    if (!available) {
      return { available: false, model: this.currentModel, switched: false, models: [] };
    }
    const models = await this.provider.listModels();
    if (models.length === 0) {
      throw new OllamaError(
        'Ollama працює, але не має жодної моделі. Встанови модель, наприклад: ollama pull qwen2.5:7b'
      );
    }
    const exact = models.find((m) => m.name === this.currentModel);
    if (exact) {
      return { available: true, model: this.currentModel, switched: false, models };
    }
    const baseName = this.currentModel.split(':')[0].toLowerCase();
    const sameFamily = models.find((m) => m.name.split(':')[0].toLowerCase() === baseName);
    const chosen = sameFamily ?? this.pickPreferred(models);
    const from = this.currentModel;
    this.currentModel = chosen.name;
    this.onModelSwitch?.(
      from,
      chosen.name,
      sameFamily ? 'інший тег тієї самої моделі' : 'модель із конфігурації відсутня в Ollama'
    );
    return { available: true, model: this.currentModel, switched: true, models };
  }

  private pickPreferred(models: ModelInfo[]): ModelInfo {
    const order = ['qwen', 'deepseek', 'mistral', 'llama'];
    for (const prefix of order) {
      const hit = models.find((m) => m.name.toLowerCase().startsWith(prefix));
      if (hit) return hit;
    }
    return models[0];
  }

  private withModel(options?: GenerateOptions): GenerateOptions {
    return { ...options, model: options?.model ?? this.currentModel };
  }

  private isModelError(err: unknown): boolean {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    return message.includes('not found') || message.includes('try pulling');
  }

  async chat(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult> {
    try {
      return await this.provider.chat(messages, this.withModel(options));
    } catch (err) {
      if (this.isModelError(err)) {
        await this.ensureReady();
        return this.provider.chat(messages, this.withModel(options));
      }
      throw err;
    }
  }

  async streamChat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    try {
      return await this.provider.streamChat(messages, this.withModel(options), onToken);
    } catch (err) {
      if (this.isModelError(err)) {
        await this.ensureReady();
        return this.provider.streamChat(messages, this.withModel(options), onToken);
      }
      throw err;
    }
  }
}