const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'is',
  'are', 'was', 'were', 'be', 'been', 'this', 'that', 'it', 'as', 'by', 'with',
  'from', 'how', 'what', 'where', 'which', 'who', 'why', 'when', 'does', 'do',
  'can', 'could', 'should', 'would', 'will', 'not', 'no', 'yes', 'me', 'my',
  'tell', 'show', 'find', 'give', 'explain', 'please',
  'і', 'й', 'та', 'або', 'в', 'у', 'на', 'до', 'з', 'із', 'зі', 'що', 'як',
  'де', 'коли', 'хто', 'який', 'яка', 'яке', 'які', 'це', 'той', 'та', 'те',
  'ті', 'для', 'про', 'по', 'за', 'від', 'над', 'під', 'при', 'чи', 'не',
  'ні', 'так', 'є', 'був', 'була', 'було', 'були', 'мене', 'мені', 'мій',
  'моя', 'моє', 'мої', 'свій', 'своя', 'своє', 'свої', 'якого', 'якій',
  'яких', 'яку', 'розкажи', 'покажи', 'знайди', 'поясни', 'будь', 'ласка',
]);

const UA_EN_STEMS: [string, string[]][] = [
  ['граф', ['graph']],
  ['залежн', ['dependency', 'dependencies', 'import', 'edge']],
  ['вхід', ['entry', 'main', 'index']],
  ['точк', ['entry', 'point']],
  ['знанн', ['knowledge']],
  ['пам', ['memory']],
  ['модел', ['model']],
  ['адаптер', ['adapter']],
  ['індекс', ['index', 'indexer']],
  ['скан', ['scan', 'scanner']],
  ['модул', ['module']],
  ['символ', ['symbol']],
  ['клас', ['class']],
  ['функці', ['function', 'func']],
  ['інтерфейс', ['interface']],
  ['метод', ['method']],
  ['помилк', ['error']],
  ['пошук', ['search', 'find']],
  ['знаход', ['find', 'search', 'locate']],
  ['зберіг', ['store', 'save']],
  ['збереж', ['store', 'save']],
  ['історі', ['history', 'memory']],
  ['розвитк', ['history', 'evolution']],
  ['язк', ['relation', 'link', 'connection', 'edge']],
  ['цикл', ['cycle', 'loop']],
  ['пакет', ['package']],
  ['директорі', ['directory', 'folder']],
  ['папк', ['folder', 'directory']],
  ['шлях', ['path']],
  ['рядк', ['line']],
  ['рядок', ['line']],
  ['вміст', ['content']],
  ['файл', ['file']],
  ['код', ['code']],
  ['проєкт', ['project']],
  ['питанн', ['question', 'ask']],
  ['відповід', ['answer', 'response']],
  ['створ', ['create', 'build']],
  ['побудов', ['build', 'graph']],
  ['ключов', ['key', 'main']],
  ['головн', ['main', 'core']],
  ['ядр', ['core']],
  ['систем', ['system']],
  ['сервіс', ['service']],
  ['тип', ['type']],
  ['дан', ['data']],
  ['структур', ['structure', 'tree']],
  ['імпорт', ['import']],
  ['експорт', ['export']],
  ['змін', ['change', 'update']],
  ['оновл', ['update', 'refresh']],
  ['видал', ['delete', 'remove']],
  ['дода', ['add', 'create']],
  ['запуск', ['start', 'run', 'main']],
  ['реалізован', ['implement']],
  ['реалізаці', ['implementation']],
  ['визнач', ['detect', 'define']],
  ['аналіз', ['analyze', 'analysis']],
  ['контракт', ['contract', 'interface']],
  ['сховищ', ['store', 'storage']],
  ['чат', ['chat']],
  ['істор', ['history']],
  ['поді', ['event']],
  ['відповідальн', ['core', 'main']],
  ['ключові', ['key', 'main']],
];

export function tokenize(text: string): string[] {
  const expanded = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const parts = expanded
    .toLowerCase()
    .split(/[^a-zа-яіїєґ0-9_]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  const result = new Set(parts);
  for (const token of parts) {
    for (const [stem, equivalents] of UA_EN_STEMS) {
      if (token.startsWith(stem)) {
        for (const equivalent of equivalents) result.add(equivalent);
      }
    }
  }
  return [...result];
}

export function scoreText(tokens: string[], text: string): number {
  if (tokens.length === 0 || !text) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) {
      const occurrences = lower.split(token).length - 1;
      score += 1 + Math.min(occurrences, 4) * 0.5;
    }
  }
  return score;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[фрагмент скорочено]`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDay(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-zа-яіїєґ0-9]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}