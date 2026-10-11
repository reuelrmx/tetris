import type { GameSummary, ModeId } from '../engine/index.ts';

/**
 * Records and statistics.
 *
 * IndexedDB is the primary store: score history grows with every play and is queried by mode and
 * by score, which is exactly what an object store with an index is for. When IndexedDB is
 * unavailable (older browsers, private modes that block it) the same API is served from
 * `localStorage`, and when even that is blocked, from memory — the game never fails to start
 * because of storage.
 */
export const DB_NAME = 'strata';
export const DB_VERSION = 1;
export const SCORES_STORE = 'scores';
export const STATS_STORE = 'stats';
export const META_STORE = 'meta';
/** Score history kept per mode; older entries are pruned so the database cannot grow forever. */
export const HISTORY_LIMIT = 50;

export interface ScoreRecord {
  readonly id?: number;
  readonly modeId: ModeId;
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  readonly durationMs: number;
  readonly seed: number;
  readonly reason: string;
  readonly result: string;
  readonly at: number;
}

export interface ModeStats {
  readonly modeId: ModeId;
  readonly plays: number;
  readonly wins: number;
  readonly totalLines: number;
  readonly totalScore: number;
  readonly totalTimeMs: number;
  readonly bestScore: number;
  readonly bestLines: number;
  /** Fastest completion of a lines-goal mode (Sprint), milliseconds. */
  readonly bestTimeMs: number | null;
  readonly quads: number;
  readonly tspins: number;
  readonly perfectClears: number;
  readonly maxCombo: number;
  readonly updatedAt: number;
}

export function emptyStats(modeId: ModeId): ModeStats {
  return {
    modeId,
    plays: 0,
    wins: 0,
    totalLines: 0,
    totalScore: 0,
    totalTimeMs: 0,
    bestScore: 0,
    bestLines: 0,
    bestTimeMs: null,
    quads: 0,
    tspins: 0,
    perfectClears: 0,
    maxCombo: 0,
    updatedAt: 0,
  };
}

export interface RecordsStore {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  recordGame(modeId: ModeId, summary: GameSummary): Promise<void>;
  getStats(modeId: ModeId): Promise<ModeStats>;
  getAllStats(): Promise<ModeStats[]>;
  getRecentScores(modeId: ModeId, limit?: number): Promise<ScoreRecord[]>;
  getBestScore(modeId: ModeId): Promise<ScoreRecord | null>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
  clearAll(): Promise<void>;
}

/** Applies a finished game to the aggregate statistics for its mode. */
export function mergeStats(stats: ModeStats, modeId: ModeId, summary: GameSummary): ModeStats {
  const won = summary.result === 'won';
  const goalTime = won && summary.reason === 'goal' ? summary.durationMs : null;
  const bestTimeMs =
    goalTime === null
      ? stats.bestTimeMs
      : stats.bestTimeMs === null || goalTime < stats.bestTimeMs
        ? goalTime
        : stats.bestTimeMs;
  return {
    modeId,
    plays: stats.plays + 1,
    wins: stats.wins + (won ? 1 : 0),
    totalLines: stats.totalLines + summary.lines,
    totalScore: stats.totalScore + summary.score,
    totalTimeMs: stats.totalTimeMs + summary.durationMs,
    bestScore: Math.max(stats.bestScore, summary.score),
    bestLines: Math.max(stats.bestLines, summary.lines),
    bestTimeMs,
    quads: stats.quads + summary.stats.quads,
    tspins: stats.tspins + summary.stats.tspins + summary.stats.miniTspins,
    perfectClears: stats.perfectClears + summary.stats.perfectClears,
    maxCombo: Math.max(stats.maxCombo, summary.stats.maxCombo),
    updatedAt: Date.now(),
  };
}

export function toScoreRecord(modeId: ModeId, summary: GameSummary): ScoreRecord {
  return {
    modeId,
    score: summary.score,
    lines: summary.lines,
    level: summary.level,
    durationMs: summary.durationMs,
    seed: summary.seed,
    reason: summary.reason,
    result: summary.result,
    at: Date.now(),
  };
}

/**
 * Opens the best available store. `indexedDB` is probed rather than feature-detected: some
 * browsers expose the API and then throw on first use.
 */
export async function openRecordsStore(fallbackStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }): Promise<RecordsStore> {
  try {
    const store = await IndexedDbRecords.open();
    if (store) return store;
  } catch {
    // fall through to the next option
  }
  if (fallbackStorage) return new JsonRecords(fallbackStorage);
  return createMemoryRecords();
}

// ---------------------------------------------------------------- IndexedDB

export class IndexedDbRecords implements RecordsStore {
  readonly kind = 'indexeddb' as const;
  private readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<IndexedDbRecords | null> {
    const factory = globalThis.indexedDB;
    if (!factory) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SCORES_STORE)) {
          const scores = database.createObjectStore(SCORES_STORE, { keyPath: 'id', autoIncrement: true });
          scores.createIndex('byMode', 'modeId');
          scores.createIndex('byModeScore', ['modeId', 'score']);
          scores.createIndex('byModeTime', ['modeId', 'durationMs']);
        }
        if (!database.objectStoreNames.contains(STATS_STORE)) {
          database.createObjectStore(STATS_STORE, { keyPath: 'modeId' });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
      request.onblocked = () => reject(new Error('indexedDB open blocked'));
    });
    return new IndexedDbRecords(db);
  }

  async recordGame(modeId: ModeId, summary: GameSummary): Promise<void> {
    const record = toScoreRecord(modeId, summary);
    const stats = await this.getStats(modeId);
    await this.transaction([SCORES_STORE, STATS_STORE], 'readwrite', (tx) => {
      tx.objectStore(SCORES_STORE).add(record);
      tx.objectStore(STATS_STORE).put(mergeStats(stats, modeId, summary));
    });
    await this.pruneHistory(modeId);
  }

  async getStats(modeId: ModeId): Promise<ModeStats> {
    const value = await this.read<ModeStats | undefined>(STATS_STORE, modeId);
    return value ? { ...emptyStats(modeId), ...value } : emptyStats(modeId);
  }

  async getAllStats(): Promise<ModeStats[]> {
    const rows = await this.readAll<ModeStats>(STATS_STORE);
    return rows.map((row) => ({ ...emptyStats(row.modeId), ...row }));
  }

  async getRecentScores(modeId: ModeId, limit = 10): Promise<ScoreRecord[]> {
    const rows = await this.readAll<ScoreRecord>(SCORES_STORE, 'byMode', modeId);
    return rows.sort((a, b) => b.at - a.at).slice(0, limit);
  }

  async getBestScore(modeId: ModeId): Promise<ScoreRecord | null> {
    const rows = await this.readAll<ScoreRecord>(SCORES_STORE, 'byMode', modeId);
    return rows.reduce<ScoreRecord | null>((best, row) => (best === null || row.score > best.score ? row : best), null);
  }

  async getMeta(key: string): Promise<unknown> {
    const row = await this.read<{ key: string; value: unknown } | undefined>(META_STORE, key);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.transaction([META_STORE], 'readwrite', (tx) => {
      tx.objectStore(META_STORE).put({ key, value });
    });
  }

  async clearAll(): Promise<void> {
    await this.transaction([SCORES_STORE, STATS_STORE, META_STORE], 'readwrite', (tx) => {
      tx.objectStore(SCORES_STORE).clear();
      tx.objectStore(STATS_STORE).clear();
      tx.objectStore(META_STORE).clear();
    });
  }

  private async pruneHistory(modeId: ModeId): Promise<void> {
    const rows = await this.readAll<ScoreRecord>(SCORES_STORE, 'byMode', modeId);
    if (rows.length <= HISTORY_LIMIT) return;
    const doomed = rows.sort((a, b) => a.at - b.at).slice(0, rows.length - HISTORY_LIMIT);
    await this.transaction([SCORES_STORE], 'readwrite', (tx) => {
      const store = tx.objectStore(SCORES_STORE);
      for (const row of doomed) if (row.id !== undefined) store.delete(row.id);
    });
  }

  private read<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error('indexedDB read failed'));
    });
  }

  private readAll<T>(storeName: string, indexName?: string, query?: IDBValidKey): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const source = indexName ? tx.objectStore(storeName).index(indexName) : tx.objectStore(storeName);
      const request = query === undefined ? source.getAll() : source.getAll(query);
      request.onsuccess = () => resolve((request.result ?? []) as T[]);
      request.onerror = () => reject(request.error ?? new Error('indexedDB read failed'));
    });
  }

  private transaction(
    stores: string[],
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, mode);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
      run(tx);
    });
  }
}

// ---------------------------------------------------------------- fallbacks

interface JsonShape {
  scores: ScoreRecord[];
  stats: Record<string, ModeStats>;
  meta: Record<string, unknown>;
}

class JsonStore {
  protected readonly storage: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
  protected readonly key: string;

  constructor(storage: JsonStore['storage'], key = 'strata.records.v1') {
    this.storage = storage;
    this.key = key;
  }

  protected read(): JsonShape {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return { scores: [], stats: {}, meta: {} };
      const parsed = JSON.parse(raw) as Partial<JsonShape>;
      return { scores: parsed.scores ?? [], stats: parsed.stats ?? {}, meta: parsed.meta ?? {} };
    } catch {
      return { scores: [], stats: {}, meta: {} };
    }
  }

  protected write(data: JsonShape): void {
    try {
      this.storage.setItem(this.key, JSON.stringify(data));
    } catch {
      // Ignore: the session continues with in-memory state.
    }
  }
}

class JsonRecords extends JsonStore implements RecordsStore {
  readonly kind = 'localstorage' as const;

  constructor(storage: JsonStore['storage']) {
    super(storage);
  }

  async recordGame(modeId: ModeId, summary: GameSummary): Promise<void> {
    const data = this.read();
    data.scores.push(toScoreRecord(modeId, summary));
    const perMode = data.scores.filter((row) => row.modeId === modeId);
    if (perMode.length > HISTORY_LIMIT) {
      const doomed = new Set(perMode.sort((a, b) => a.at - b.at).slice(0, perMode.length - HISTORY_LIMIT));
      data.scores = data.scores.filter((row) => !doomed.has(row));
    }
    data.stats[modeId] = mergeStats(data.stats[modeId] ?? emptyStats(modeId), modeId, summary);
    this.write(data);
  }

  async getStats(modeId: ModeId): Promise<ModeStats> {
    return this.read().stats[modeId] ?? emptyStats(modeId);
  }

  async getAllStats(): Promise<ModeStats[]> {
    return Object.values(this.read().stats);
  }

  async getRecentScores(modeId: ModeId, limit = 10): Promise<ScoreRecord[]> {
    return this.read()
      .scores.filter((row) => row.modeId === modeId)
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  }

  async getBestScore(modeId: ModeId): Promise<ScoreRecord | null> {
    return this.read()
      .scores.filter((row) => row.modeId === modeId)
      .reduce<ScoreRecord | null>((best, row) => (best === null || row.score > best.score ? row : best), null);
  }

  async getMeta(key: string): Promise<unknown> {
    return this.read().meta[key] ?? null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const data = this.read();
    data.meta[key] = value;
    this.write(data);
  }

  async clearAll(): Promise<void> {
    this.write({ scores: [], stats: {}, meta: {} });
  }
}

/** A store that never touches the disk: used by tests and as a last-resort fallback. */
export function createMemoryRecords(): RecordsStore {
  let counter = 0;
  const scores: ScoreRecord[] = [];
  const stats = new Map<string, ModeStats>();
  const meta = new Map<string, unknown>();
  return {
    kind: 'memory',
    async recordGame(modeId, summary) {
      scores.push({ ...toScoreRecord(modeId, summary), id: ++counter });
      stats.set(modeId, mergeStats(stats.get(modeId) ?? emptyStats(modeId), modeId, summary));
    },
    async getStats(modeId) {
      return stats.get(modeId) ?? emptyStats(modeId);
    },
    async getAllStats() {
      return [...stats.values()];
    },
    async getRecentScores(modeId, limit = 10) {
      return scores
        .filter((row) => row.modeId === modeId)
        .sort((a, b) => b.at - a.at)
        .slice(0, limit);
    },
    async getBestScore(modeId) {
      return scores
        .filter((row) => row.modeId === modeId)
        .reduce<ScoreRecord | null>((best, row) => (best === null || row.score > best.score ? row : best), null);
    },
    async getMeta(key) {
      return meta.get(key) ?? null;
    },
    async setMeta(key, value) {
      meta.set(key, value);
    },
    async clearAll() {
      scores.length = 0;
      stats.clear();
      meta.clear();
    },
  };
}
