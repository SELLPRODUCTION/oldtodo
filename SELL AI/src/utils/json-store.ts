import * as fs from 'fs';
import * as path from 'path';

export class JsonStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly fallback: T
  ) {}

  get location(): string {
    return this.filePath;
  }

  load(): T {
    try {
      if (!fs.existsSync(this.filePath)) {
        return this.fallback;
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      if (!raw.trim()) {
        return this.fallback;
      }
      return JSON.parse(raw) as T;
    } catch {
      return this.fallback;
    }
  }

  save(data: T): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }
}