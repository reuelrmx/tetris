import {
  LIMITS,
  PROTOCOL_VERSION,
  encode,
  normaliseRoomCode,
  parseServerMessage,
} from '../../shared/protocol.ts';
import type {
  AttackDetail,
  BoardSummary,
  ClientMessage,
  MatchEndReason,
  PlayerInfo,
  ServerMessage,
} from '../../shared/protocol.ts';

/**
 * The multiplayer client.
 *
 * Owns one WebSocket, the heartbeat, the reconnect/backoff policy and the match state machine
 * that the versus screen renders. It never mutates game state directly: attacks go out, garbage
 * comes in through a callback, and everything the player sees about the match comes from server
 * messages (`MatchState`).
 *
 * Reconnection uses an anonymous session token: the server hands one out with `welcome` and the
 * client presents it again on `hello`, which is how a dropped match can be resumed.
 */
export type MatchPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'queueing'
  | 'lobby'
  | 'countdown'
  | 'playing'
  | 'ended'
  | 'error';

export interface MatchState {
  readonly phase: MatchPhase;
  readonly roomCode: string | null;
  readonly players: readonly PlayerInfo[];
  readonly queuePosition: number | null;
  readonly countdownSeconds: number | undefined;
  readonly seed: number | null;
  readonly selfId: string | null;
  readonly message: string;
}

export const INITIAL_MATCH_STATE: MatchState = {
  phase: 'idle',
  roomCode: null,
  players: [],
  queuePosition: null,
  countdownSeconds: undefined,
  seed: null,
  selfId: null,
  message: '',
};

export interface MatchClientOptions {
  /** Empty string means "same origin"; a relative path is resolved against the page. */
  readonly endpoint: string;
  readonly name: string;
  readonly onState: (state: MatchState) => void;
  readonly onGarbage: (rows: number, holeColumn: number) => void;
  readonly onNotice?: (message: string, kind: 'info' | 'ok' | 'error') => void;
  readonly onError?: (message: string) => void;
  /** Milliseconds between heartbeats (default 5 s). */
  readonly heartbeatMs?: number;
  /** Milliseconds without a server frame before the client declares the link dead (default 15 s). */
  readonly timeoutMs?: number;
}

export interface MatchClient {
  connect(): Promise<void>;
  readonly state: MatchState;
  queue(): void;
  cancelQueue(): void;
  createRoom(): void;
  joinRoom(code: string): void;
  setReady(ready: boolean): void;
  sendAttack(lines: number, detail: AttackDetail): void;
  sendBoardSummary(summary: Omit<BoardSummary, 'pieces'> & { pieces?: number }): void;
  reportResult(score: number, lines: number, won: boolean): void;
  leave(): void;
  close(): void;
}

const RECONNECT_DELAYS_MS = [600, 1500, 3000, 6000, 10_000];

export function resolveWebSocketUrl(endpoint: string): string {
  if (endpoint.trim().length > 0) {
    const trimmed = endpoint.trim();
    if (/^wss?:\/\//i.test(trimmed)) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^http/i, 'ws');
    // A bare path such as /ws is resolved against the current origin.
    const base = typeof location === 'undefined' ? 'ws://localhost' : location.href;
    const url = new URL(trimmed, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }
  if (typeof location === 'undefined') return 'ws://localhost:8787/ws';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

export function createMatchClient(options: MatchClientOptions): MatchClient {
  const heartbeatMs = options.heartbeatMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let socket: WebSocket | null = null;
  let state: MatchState = INITIAL_MATCH_STATE;
  let seq = 0;
  let nonce = 0;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lastServerFrameAt = 0;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionToken: string | null = null;
  let closedByUser = false;
  let wantsRoom: { kind: 'queue' } | { kind: 'create' } | { kind: 'join'; code: string } | null = null;

  const setState = (patch: Partial<MatchState>): void => {
    state = { ...state, ...patch };
    options.onState(state);
  };

  const send = (message: ClientMessage): boolean => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(encode(message));
    return true;
  };

  const stopHeartbeat = (): void => {
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
  };

  const scheduleReconnect = (): void => {
    if (closedByUser || reconnectTimer !== null) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ?? 10_000;
    reconnectAttempt += 1;
    setState({ phase: 'connecting', message: `Reconnecting in ${Math.round(delay / 1000)} s…` });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  const handleMessage = (message: ServerMessage): void => {
    switch (message.t) {
      case 'welcome': {
        sessionToken = sessionToken ?? message.playerId;
        reconnectAttempt = 0;
        setState({ phase: 'connected', selfId: message.playerId, message: '' });
        // Resume whatever the player was doing before the drop.
        if (wantsRoom?.kind === 'queue') send({ v: PROTOCOL_VERSION, t: 'queue' });
        else if (wantsRoom?.kind === 'create') send({ v: PROTOCOL_VERSION, t: 'create_room' });
        else if (wantsRoom?.kind === 'join') send({ v: PROTOCOL_VERSION, t: 'join_room', code: wantsRoom.code });
        break;
      }
      case 'queued':
        setState({ phase: 'queueing', queuePosition: message.position, message: 'Waiting for an opponent' });
        break;
      case 'room':
        setState({
          phase: message.code ? 'lobby' : 'connected',
          roomCode: message.code,
          players: message.players,
          message: message.code ? 'Private room' : '',
        });
        break;
      case 'player': {
        const players = state.players.some((player) => player.id === message.player.id)
          ? state.players.map((player) => (player.id === message.player.id ? message.player : player))
          : [...state.players, message.player];
        setState({ players });
        break;
      }
      case 'player_left':
        setState({ players: state.players.filter((player) => player.id !== message.playerId) });
        break;
      case 'countdown':
        setState({ phase: message.seconds > 0 ? 'countdown' : 'playing', countdownSeconds: message.seconds });
        break;
      case 'match_start':
        setState({
          phase: 'playing',
          seed: message.seed,
          players: message.players,
          message: 'Match started',
        });
        options.onNotice?.('Match started', 'ok');
        break;
      case 'garbage':
        options.onGarbage(message.rows, message.holeColumn);
        send({ v: PROTOCOL_VERSION, t: 'garbage_received', seq: message.seq, rows: message.rows });
        break;
      case 'opponent_attack':
        options.onNotice?.(`${message.lines} incoming from opponent`, 'info');
        break;
      case 'opponent_board':
        setState({
          players: state.players.map((player) =>
            player.id === message.playerId ? { ...player, board: message.summary } : player,
          ),
        });
        break;
      case 'match_end':
        setState({
          phase: 'ended',
          message: describeEnd(message.winnerId, state.selfId, message.reason),
        });
        options.onNotice?.(describeEnd(message.winnerId, state.selfId, message.reason), 'info');
        break;
      case 'notice':
        options.onNotice?.(message.message, message.kind);
        break;
      case 'error':
        setState({ message: message.message });
        options.onError?.(message.message);
        if (message.fatal) {
          closedByUser = true;
          setState({ phase: 'error' });
        }
        break;
      case 'ping':
        send({ v: PROTOCOL_VERSION, t: 'pong', nonce: message.nonce });
        break;
      case 'pong':
        break;
      default:
        break;
    }
  };

  const connect = async (): Promise<void> => {
    if (closedByUser) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    setState({ phase: 'connecting', message: 'Connecting…' });
    const url = resolveWebSocketUrl(options.endpoint);
    try {
      socket = new WebSocket(url);
    } catch (error) {
      setState({ phase: 'error', message: 'Could not open a WebSocket' });
      options.onError?.(error instanceof Error ? error.message : 'WebSocket failed');
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      lastServerFrameAt = Date.now();
      reconnectAttempt = 0;
      send({
        v: PROTOCOL_VERSION,
        t: 'hello',
        name: options.name.slice(0, LIMITS.name),
        client: 'strata-web',
        ...(sessionToken ? { resume: sessionToken } : {}),
      });
      stopHeartbeat();
      heartbeat = setInterval(() => {
        if (Date.now() - lastServerFrameAt > timeoutMs) {
          options.onNotice?.('Connection timed out; reconnecting', 'error');
          try {
            socket?.close();
          } catch {
            // ignore
          }
          return;
        }
        nonce = (nonce + 1) % LIMITS.sequence;
        send({ v: PROTOCOL_VERSION, t: 'ping', nonce });
      }, heartbeatMs);
    });

    socket.addEventListener('message', (event) => {
      lastServerFrameAt = Date.now();
      const parsed = parseServerMessage(typeof event.data === 'string' ? event.data : '');
      if (!parsed.ok) return;
      handleMessage(parsed.value);
    });

    socket.addEventListener('close', () => {
      stopHeartbeat();
      socket = null;
      if (closedByUser) {
        setState({ phase: 'idle', message: 'Disconnected' });
        return;
      }
      options.onNotice?.('Lost connection to the match server', 'error');
      scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      options.onError?.('WebSocket error');
    });
  };

  return {
    connect,
    get state() {
      return state;
    },
    queue() {
      wantsRoom = { kind: 'queue' };
      if (!send({ v: PROTOCOL_VERSION, t: 'queue' })) {
        setState({ phase: 'connecting', message: 'Connecting…' });
        void connect();
      }
    },
    cancelQueue() {
      wantsRoom = null;
      send({ v: PROTOCOL_VERSION, t: 'cancel_queue' });
      setState({ phase: 'connected', queuePosition: null, message: '' });
    },
    createRoom() {
      wantsRoom = { kind: 'create' };
      if (!send({ v: PROTOCOL_VERSION, t: 'create_room' })) void connect();
    },
    joinRoom(code: string) {
      const normalised = normaliseRoomCode(code);
      if (!normalised) {
        options.onError?.('Room codes are six characters, letters and digits only');
        return;
      }
      wantsRoom = { kind: 'join', code: normalised };
      if (!send({ v: PROTOCOL_VERSION, t: 'join_room', code: normalised })) void connect();
    },
    setReady(ready: boolean) {
      send({ v: PROTOCOL_VERSION, t: 'ready', ready });
    },
    sendAttack(lines: number, detail: AttackDetail) {
      seq = (seq + 1) % LIMITS.sequence;
      const clamped = Math.max(0, Math.min(LIMITS.attackLines, Math.round(lines)));
      send({ v: PROTOCOL_VERSION, t: 'attack', lines: clamped, detail, seq });
    },
    sendBoardSummary(summary) {
      seq = (seq + 1) % LIMITS.sequence;
      send({
        v: PROTOCOL_VERSION,
        t: 'board',
        summary: {
          lines: Math.max(0, Math.round(summary.lines)),
          score: Math.max(0, Math.round(summary.score)),
          level: Math.max(1, Math.round(summary.level)),
          stackHeight: Math.max(0, Math.min(200, Math.round(summary.stackHeight))),
          pieces: Math.max(0, Math.round(summary.pieces ?? 0)),
        },
        seq,
      });
    },
    reportResult(score: number, lines: number, won: boolean) {
      send({
        v: PROTOCOL_VERSION,
        t: 'result',
        score: Math.max(0, Math.min(LIMITS.score, Math.round(score))),
        lines: Math.max(0, Math.round(lines)),
        won,
      });
    },
    leave() {
      wantsRoom = null;
      send({ v: PROTOCOL_VERSION, t: 'leave' });
      setState({ phase: 'connected', roomCode: null, players: [], queuePosition: null, message: '' });
    },
    close() {
      closedByUser = true;
      stopHeartbeat();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try {
        socket?.close();
      } catch {
        // ignore
      }
      socket = null;
      setState({ phase: 'idle', message: '' });
    },
  };
}

export function describeEnd(
  winnerId: string | null,
  selfId: string | null,
  reason: MatchEndReason,
): string {
  if (winnerId === null) return 'Match drawn';
  if (winnerId === selfId) {
    switch (reason) {
      case 'forfeit':
        return 'You win — opponent forfeited';
      case 'disconnect':
        return 'You win — opponent disconnected';
      case 'draw':
        return 'Match drawn';
      default:
        return 'You win';
    }
  }
  switch (reason) {
    case 'forfeit':
      return 'You forfeited the match';
    case 'disconnect':
      return 'You lost connection and forfeited';
    default:
      return 'You lost';
  }
}
