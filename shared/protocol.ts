/**
 * STRATA multiplayer protocol, version 1.
 *
 * The same module is imported by the browser client (`src/net/client.ts`) and by the Node server
 * (`server/src/*`), so the message shapes and the validators cannot drift apart. Everything is
 * JSON with a `t` (type) discriminator and a `v` (protocol version) field.
 *
 * Design rules:
 *
 *  1. The server validates every client message before it touches match state. Unknown types,
 *     wrong field types, out-of-range numbers and oversized strings are rejected with an `error`
 *     message; a client that keeps sending invalid frames is disconnected.
 *  2. The server never trusts gameplay outcomes. Attacks are *recomputed* from the clear data the
 *     client reports, using the same scoring module the game uses, and are clamped to the attack
 *     table's burst cap. See `docs/PROTOCOL.md` for the honest limits of this model.
 *  3. Every frame carries only what the other side needs. Board summaries are throttled by the
 *     client to 5 Hz, not per frame.
 */
export const PROTOCOL_VERSION = 1;

/** Hard limits enforced by the server; also used by the client to trim what it sends. */
export const LIMITS = {
  /** Characters in a display name. */
  name: 16,
  /** Characters in a room code. */
  roomCode: 6,
  /** Sequential number, ignored except for ordering checks. */
  sequence: 2 ** 31 - 1,
  /** Attack lines a single clear may forward, matching the ruleset's burst cap. */
  attackLines: 20,
  /** Garbage rows the server will ever push in one message. */
  garbageRows: 8,
  /** Client messages per second before the connection is throttled. */
  messagesPerSecond: 40,
  /** Score a single match result may report (sanity bound). */
  score: 1e9,
} as const;

export interface AttackDetail {
  /** Lines the client's engine cleared on this lock. */
  readonly lines: number;
  readonly spin: 'none' | 'mini' | 'tspin';
  readonly combo: number;
  readonly backToBack: boolean;
  readonly perfectClear: boolean;
}

export interface BoardSummary {
  readonly lines: number;
  readonly score: number;
  readonly level: number;
  /** Filled cells in the well, used for the opponent's mini board. */
  readonly stackHeight: number;
  /** Pieces the player has locked, so the server knows when garbage may start flowing. */
  readonly pieces: number;
}

export interface PlayerInfo {
  readonly id: string;
  readonly name: string;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly self?: boolean;
  /** Latest board summary, for the opponent's mini board. Absent until the first report. */
  readonly board?: BoardSummary;
}

/** Why a match ended. `topout` means a player could not place a piece. */
export type MatchEndReason = 'topout' | 'forfeit' | 'disconnect' | 'draw';

// ---------------------------------------------------------------- client -> server

export type ClientMessage =
  | {
      readonly v: number;
      readonly t: 'hello';
      readonly name: string;
      readonly client: string;
      /** Anonymous session token from an earlier `welcome`, to resume a match after a drop. */
      readonly resume?: string;
    }
  | { readonly v: number; readonly t: 'queue' }
  | { readonly v: number; readonly t: 'cancel_queue' }
  | { readonly v: number; readonly t: 'create_room' }
  | { readonly v: number; readonly t: 'join_room'; readonly code: string }
  | { readonly v: number; readonly t: 'ready'; readonly ready: boolean }
  | { readonly v: number; readonly t: 'attack'; readonly lines: number; readonly detail: AttackDetail; readonly seq: number }
  | { readonly v: number; readonly t: 'board'; readonly summary: BoardSummary; readonly seq: number }
  | { readonly v: number; readonly t: 'garbage_received'; readonly seq: number; readonly rows: number }
  | { readonly v: number; readonly t: 'result'; readonly score: number; readonly lines: number; readonly won: boolean }
  | { readonly v: number; readonly t: 'leave' }
  | { readonly v: number; readonly t: 'ping'; readonly nonce: number }
  | { readonly v: number; readonly t: 'pong'; readonly nonce: number };

export type ClientMessageType = ClientMessage['t'];

// ---------------------------------------------------------------- server -> client

export interface GarbageMessage {
  readonly v: number;
  readonly t: 'garbage';
  readonly rows: number;
  readonly holeColumn: number;
  readonly seq: number;
}

export type ServerMessage =
  | {
      readonly v: number;
      readonly t: 'welcome';
      readonly playerId: string;
      readonly name: string;
      readonly protocol: number;
      readonly serverTime: number;
      readonly limits: typeof LIMITS;
    }
  | { readonly v: number; readonly t: 'queued'; readonly position: number }
  | { readonly v: number; readonly t: 'room'; readonly code: string | null; readonly players: readonly PlayerInfo[] }
  | { readonly v: number; readonly t: 'player'; readonly player: PlayerInfo }
  | { readonly v: number; readonly t: 'player_left'; readonly playerId: string }
  | {
      readonly v: number;
      readonly t: 'match_start';
      readonly seed: number;
      readonly mode: string;
      readonly rulesId: string;
      readonly startLevel: number;
      readonly players: readonly PlayerInfo[];
      readonly serverTime: number;
    }
  | { readonly v: number; readonly t: 'countdown'; readonly seconds: number }
  | { readonly v: number; readonly t: 'opponent_attack'; readonly lines: number; readonly from: string }
  | { readonly v: number; readonly t: 'opponent_board'; readonly playerId: string; readonly summary: BoardSummary }
  | GarbageMessage
  | {
      readonly v: number;
      readonly t: 'match_end';
      readonly winnerId: string | null;
      readonly reason: MatchEndReason;
      readonly players: readonly { readonly id: string; readonly score: number; readonly lines: number }[];
    }
  | { readonly v: number; readonly t: 'notice'; readonly message: string; readonly kind: 'info' | 'ok' | 'error' }
  | { readonly v: number; readonly t: 'error'; readonly code: string; readonly message: string; readonly fatal: boolean }
  | { readonly v: number; readonly t: 'ping'; readonly nonce: number }
  | { readonly v: number; readonly t: 'pong'; readonly nonce: number };

export type ServerMessageType = ServerMessage['t'];

// ---------------------------------------------------------------- encoding

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly detail: string };

function fail(code: string, detail: string): ParseResult<never> {
  return { ok: false, code, detail };
}

function parseJson(raw: unknown): ParseResult<Record<string, unknown>> {
  if (typeof raw !== 'string') return fail('not_text', 'frame was not text');
  if (raw.length > 8192) return fail('too_large', 'frame exceeded 8 KiB');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('bad_json', 'frame was not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('bad_shape', 'message must be a JSON object');
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

/** Type guards used by both the validator below and the client's own checks. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isIntInRange(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= min && value <= max;
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

const SPINS = new Set(['none', 'mini', 'tspin']);

export function parseAttackDetail(value: unknown): AttackDetail | null {
  if (typeof value !== 'object' || value === null) return null;
  const detail = value as Record<string, unknown>;
  if (!isIntInRange(detail.lines, 0, 4)) return null;
  if (typeof detail.spin !== 'string' || !SPINS.has(detail.spin)) return null;
  if (!isIntInRange(detail.combo, 0, 999)) return null;
  if (typeof detail.backToBack !== 'boolean') return null;
  if (typeof detail.perfectClear !== 'boolean') return null;
  return {
    lines: detail.lines,
    spin: detail.spin as AttackDetail['spin'],
    combo: detail.combo,
    backToBack: detail.backToBack,
    perfectClear: detail.perfectClear,
  };
}

export function parseBoardSummary(value: unknown): BoardSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const summary = value as Record<string, unknown>;
  if (!isIntInRange(summary.lines, 0, 1e7)) return null;
  if (!isIntInRange(summary.score, 0, LIMITS.score)) return null;
  if (!isIntInRange(summary.level, 1, 99)) return null;
  if (!isIntInRange(summary.stackHeight, 0, 200)) return null;
  if (!isIntInRange(summary.pieces, 0, 1e6)) return null;
  return {
    lines: summary.lines,
    score: summary.score,
    level: summary.level,
    stackHeight: summary.stackHeight,
    pieces: summary.pieces,
  };
}

/**
 * Validates one client frame. Returns a discriminated result rather than throwing, so the server
 * can answer with a precise error and keep the connection alive for recoverable mistakes.
 */
export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  const json = parseJson(raw);
  if (!json.ok) return json;
  const message = json.value;
  const { v, t } = message;
  if (v !== PROTOCOL_VERSION) return fail('bad_version', `expected protocol ${PROTOCOL_VERSION}`);
  if (typeof t !== 'string') return fail('bad_type', 'missing message type');

  switch (t) {
    case 'hello': {
      if (!isShortString(message.name, LIMITS.name) && message.name !== '') {
        return fail('bad_name', `name must be 1..${LIMITS.name} characters`);
      }
      if (typeof message.client !== 'string' || message.client.length > 32) {
        return fail('bad_client', 'client id must be a short string');
      }
      if (message.resume !== undefined && !isShortString(message.resume, 40)) {
        return fail('bad_resume', 'resume token must be a short string');
      }
      return {
        ok: true,
        value: {
          v,
          t,
          name: (message.name as string) || 'Player',
          client: message.client,
          ...(typeof message.resume === 'string' ? { resume: message.resume } : {}),
        },
      };
    }
    case 'queue':
    case 'cancel_queue':
    case 'leave':
      return { ok: true, value: { v, t } };
    case 'create_room':
      return { ok: true, value: { v, t } };
    case 'join_room': {
      if (!isShortString(message.code, LIMITS.roomCode)) return fail('bad_code', 'room code must be 6 characters');
      return { ok: true, value: { v, t, code: message.code.toUpperCase() } };
    }
    case 'ready': {
      if (typeof message.ready !== 'boolean') return fail('bad_ready', 'ready must be a boolean');
      return { ok: true, value: { v, t, ready: message.ready } };
    }
    case 'attack': {
      const detail = parseAttackDetail(message.detail);
      if (!detail) return fail('bad_detail', 'attack detail is malformed');
      if (!isIntInRange(message.lines, 0, LIMITS.attackLines)) {
        return fail('bad_lines', `attack lines must be 0..${LIMITS.attackLines}`);
      }
      if (!isIntInRange(message.seq, 0, LIMITS.sequence)) return fail('bad_seq', 'sequence out of range');
      return { ok: true, value: { v, t, lines: message.lines, detail, seq: message.seq } };
    }
    case 'board': {
      const summary = parseBoardSummary(message.summary);
      if (!summary) return fail('bad_summary', 'board summary is malformed');
      if (!isIntInRange(message.seq, 0, LIMITS.sequence)) return fail('bad_seq', 'sequence out of range');
      return { ok: true, value: { v, t, summary, seq: message.seq } };
    }
    case 'garbage_received': {
      if (!isIntInRange(message.rows, 0, 40)) return fail('bad_rows', 'rows out of range');
      if (!isIntInRange(message.seq, 0, LIMITS.sequence)) return fail('bad_seq', 'sequence out of range');
      return { ok: true, value: { v, t, rows: message.rows, seq: message.seq } };
    }
    case 'result': {
      if (!isIntInRange(message.score, 0, LIMITS.score)) return fail('bad_score', 'score out of range');
      if (!isIntInRange(message.lines, 0, 1e7)) return fail('bad_lines', 'lines out of range');
      if (typeof message.won !== 'boolean') return fail('bad_won', 'won must be a boolean');
      return { ok: true, value: { v, t, score: message.score, lines: message.lines, won: message.won } };
    }
    case 'ping':
    case 'pong': {
      if (!isIntInRange(message.nonce, 0, LIMITS.sequence)) return fail('bad_nonce', 'nonce out of range');
      return { ok: true, value: { v, t, nonce: message.nonce } };
    }
    default:
      return fail('unknown_type', `unsupported message type ${JSON.stringify(t)}`);
  }
}

/** Validates one server frame; used by the client and by the tests. */
export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  const json = parseJson(raw);
  if (!json.ok) return json;
  const message = json.value;
  if (message.v !== PROTOCOL_VERSION) return fail('bad_version', `expected protocol ${PROTOCOL_VERSION}`);
  const t = message.t;
  if (typeof t !== 'string') return fail('bad_type', 'missing message type');
  const known: ServerMessageType[] = [
    'welcome',
    'queued',
    'room',
    'player',
    'player_left',
    'match_start',
    'countdown',
    'opponent_attack',
    'opponent_board',
    'garbage',
    'match_end',
    'notice',
    'error',
    'ping',
    'pong',
  ];
  if (!known.includes(t as ServerMessageType)) {
    return fail('unknown_type', `unsupported message type ${JSON.stringify(t)}`);
  }
  // Field-level validation is deliberately light on the client side: the client only has to
  // protect itself from crashes, and every field it uses is read defensively. The server is the
  // side that must be strict, and it is (parseClientMessage above).
  return { ok: true, value: message as unknown as ServerMessage };
}

/** Human-readable room code alphabet: no 0/O/1/I to keep codes readable when read aloud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normaliseRoomCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== LIMITS.roomCode) return null;
  for (const char of cleaned) if (!ROOM_CODE_ALPHABET.includes(char)) return null;
  return cleaned;
}

export function isRoomCode(input: string): boolean {
  return normaliseRoomCode(input) !== null;
}
