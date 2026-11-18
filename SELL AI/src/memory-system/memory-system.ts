import * as crypto from 'crypto';
import { IMemorySystem } from '../types/contracts';
import {
  ChatMessage,
  MemoryData,
  MemoryEvent,
  MemoryEventType,
  TimelineDay,
} from '../types/models';
import { JsonStore } from '../utils/json-store';
import { formatDay } from '../utils/text';

const MAX_EVENTS = 5000;
const MAX_CHAT_MESSAGES = 200;

export class MemorySystem implements IMemorySystem {
  private data: MemoryData;

  constructor(private readonly store: JsonStore<MemoryData>) {
    const loaded = store.load();
    this.data = {
      events: Array.isArray(loaded.events) ? loaded.events : [],
      chat: Array.isArray(loaded.chat) ? loaded.chat : [],
    };
  }

  record(
    type: MemoryEventType,
    summary: string,
    payload: Record<string, unknown> = {}
  ): MemoryEvent {
    const event: MemoryEvent = {
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      summary,
      payload,
    };
    this.data.events.push(event);
    if (this.data.events.length > MAX_EVENTS) {
      this.data.events = this.data.events.slice(-MAX_EVENTS);
    }
    this.store.save(this.data);
    return event;
  }

  getEvents(limit = 50, type?: MemoryEventType): MemoryEvent[] {
    const filtered = type
      ? this.data.events.filter((e) => e.type === type)
      : this.data.events;
    return filtered.slice(-limit).reverse();
  }

  getTimeline(): TimelineDay[] {
    const byDay = new Map<string, MemoryEvent[]>();
    for (const event of this.data.events) {
      const day = formatDay(event.timestamp);
      const list = byDay.get(day) ?? [];
      list.push(event);
      byDay.set(day, list);
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, events]) => ({ date, events }));
  }

  appendChatTurn(question: string, answer: string): void {
    this.data.chat.push({ role: 'user', content: question });
    this.data.chat.push({ role: 'assistant', content: answer });
    if (this.data.chat.length > MAX_CHAT_MESSAGES) {
      this.data.chat = this.data.chat.slice(-MAX_CHAT_MESSAGES);
    }
    this.store.save(this.data);
  }

  getChatHistory(turns = 3): ChatMessage[] {
    return this.data.chat.slice(-turns * 2);
  }

  clearChat(): void {
    this.data.chat = [];
    this.store.save(this.data);
    this.record('system', 'Історію чату очищено');
  }
}