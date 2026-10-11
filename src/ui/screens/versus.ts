import { MODES } from '../../engine/index.ts';
import { GameSession, nextSeed } from '../game-session.ts';
import { attachTouchPad } from '../../input/touch.ts';
import { button, el } from '../dom.ts';
import type { ScreenContext, ScreenInstance } from '../navigation.ts';
import { createMatchClient } from '../../net/client.ts';
import type { MatchClient } from '../../net/client.ts';
import { INITIAL_MATCH_STATE } from '../../net/client.ts';
import type { MatchState } from '../../net/client.ts';
import type { PlayerInfo } from '../../../shared/protocol.ts';
import type { ScreenDeps } from './deps.ts';

/**
 * Versus: online matches against another player.
 *
 * The screen is a thin shell around the shared `GameSession`: the session plays the game and the
 * match client moves attacks and opponent summaries over the wire. Everything the player sees
 * about the network — queue position, countdown, opponent board, connection state — comes from the
 * protocol state pushed by the client, never from optimistic guesses.
 */
export function createVersusScreen(deps: ScreenDeps, context: ScreenContext): ScreenInstance {
  const mode = MODES.versus;
  let client: MatchClient | null = null;
  let session: GameSession | null = null;
  let padHandle: { destroy(): void } | null = null;

  const lobby = el('div', { class: 'screen' });
  const status = el('p', { class: 'muted' });
  const playerSlots = new Map<string, { panel: HTMLElement; name: HTMLElement; ready: HTMLElement; board: HTMLElement }>();

  const element = el('section', { class: 'screen' });

  const destroyGame = (): void => {
    padHandle?.destroy();
    padHandle = null;
    session?.dispose();
    session = null;
    deps.router.attach(null);
  };

  const renderLobby = (state: MatchState): void => {
    while (lobby.firstChild) lobby.removeChild(lobby.firstChild);
    if (state.phase === 'playing') return;

    const message =
      state.phase === 'connecting'
        ? 'Connecting to the match server…'
        : state.phase === 'queueing'
          ? `Looking for an opponent — position ${state.queuePosition ?? 1}`
          : state.phase === 'lobby'
            ? 'Private room. Share the code, then ready up.'
            : state.phase === 'countdown'
              ? 'Match starting'
              : 'Connection closed';

    lobby.append(
      el('h1', { text: 'Versus' }),
      status,
      el('p', { class: 'muted', text: message }),
    );

    if (state.roomCode) {
      lobby.append(
        el('div', { class: 'room-code' }, [
          el('span', { class: 'eyebrow', text: 'Room' }),
          el('span', { class: 'room-code__value', text: state.roomCode }),
          button('Copy', {
            class: 'btn',
            on: {
              click: async () => {
                try {
                  await navigator.clipboard.writeText(state.roomCode ?? '');
                  deps.toasts.show('Room code copied', 'ok');
                } catch {
                  deps.toasts.show('Copy the code from the screen', 'error');
                }
              },
            },
          }),
        ]),
      );
    }

    const panels = el('div', { class: 'lobby' });
    for (const player of state.players) {
      panels.appendChild(playerPanel(player, state));
    }
    lobby.append(panels);

    const actions = el('div', { class: 'btn-row' }, []);
    const self = state.players.find((player) => player.self);
    if (state.phase === 'lobby') {
      actions.append(
        button(self?.ready ? 'Not ready' : 'Ready', {
          class: self?.ready ? 'btn' : 'btn btn--primary',
          on: { click: () => client?.setReady(!self?.ready) },
        }),
      );
    }
    if (state.phase === 'queueing' || state.phase === 'connected') {
      actions.append(
        button('Cancel', { class: 'btn', on: { click: () => client?.cancelQueue() } }),
      );
    }
    actions.append(
      button('Leave', {
        class: 'btn btn--danger',
        on: {
          click: () => {
            client?.leave();
            context.reset('modes');
          },
        },
      }),
    );
    lobby.append(actions);

    if (state.phase === 'countdown') {
      lobby.append(
        el('div', { class: 'countdown' }, [
          el('div', { class: 'countdown__value num', text: String(state.countdownSeconds ?? 3) }),
          el('p', { class: 'muted', text: 'Boards freeze until the countdown ends.' }),
        ]),
      );
    }
  };

  const playerPanel = (player: PlayerInfo, state: MatchState): HTMLElement => {
    let slot = playerSlots.get(player.id);
    if (!slot) {
      const name = el('span', { class: 'num' });
      const ready = el('span', { class: 'tag' });
      const board = el('div', { class: 'mini-board', attrs: { 'aria-hidden': 'true' } });
      const panel = el('div', { class: 'player-panel' }, [
        el('div', { class: 'player-panel__name' }, [name, ready]),
        board,
      ]);
      slot = { panel, name, ready, board };
      playerSlots.set(player.id, slot);
    }
    slot.name.textContent = player.name + (player.self ? ' (you)' : '');
    slot.ready.textContent = player.ready ? 'Ready' : player.connected ? 'Waiting' : 'Disconnected';
    slot.ready.className = player.ready ? 'tag tag--accent' : 'tag';
    renderMiniBoard(slot.board, player);
    if (state.countdownSeconds !== undefined) {
      slot.panel.dataset.countdown = String(state.countdownSeconds);
    }
    return slot.panel;
  };

  const startMatch = (state: MatchState): void => {
    if (session) return;
    destroyGame();
    const self = state.players.find((player) => player.self);
    void self;
    const seed = state.seed ?? nextSeed();
    session = new GameSession({
      mode,
      seed,
      attacksEnabled: true,
      settings: deps.settings,
      audio: deps.audio,
      router: deps.router,
      keyboard: deps.keyboard,
      allowPause: false,
      callbacks: {
        onRequestPause: () => undefined,
        onFinished: (summary) => {
          client?.reportResult(summary.score, summary.lines, summary.result === 'won');
        },
        onAttack: (lines, result) => {
          client?.sendAttack(lines, {
            lines: result.linesCleared,
            spin: result.spin,
            combo: result.combo,
            backToBack: result.backToBack,
            perfectClear: result.perfectClear,
          });
        },
        onBoardChanged: (summary) => client?.sendBoardSummary(summary),
      },
    });
    padHandle = attachTouchPad(session.view.touchPad, deps.router);
    element.appendChild(session.view.element);
    session.setPaused(true);
    session.start();
    session.setPaused(true);
    deps.toasts.show('Match starting — boards unlock after the countdown', 'info');
  };

  const stopMatch = (): void => {
    session?.dispose();
    session = null;
    padHandle?.destroy();
    padHandle = null;
    while (element.firstChild) element.removeChild(element.firstChild);
    element.appendChild(lobby);
  };

  client = createMatchClient({
    endpoint: deps.settings.versusEndpoint,
    name: deps.settings.playerName || 'Player',
    onState: (state) => {
      if (state.phase === 'playing') {
        if (!session) {
          startMatch(state);
        } else if (state.countdownSeconds !== undefined) {
          session.setPaused(state.countdownSeconds > 0);
        }
      } else {
        if (session) stopMatch();
        renderLobby(state);
      }
      updateStatus(state);
    },
    onGarbage: (rows, holeColumn) => session?.receiveGarbage(rows, holeColumn),
    onNotice: (message, kind) => deps.toasts.show(message, kind),
    onError: (message) => {
      deps.toasts.show(message, 'error');
      status.textContent = message;
    },
  });

  const updateStatus = (state: MatchState): void => {
    status.textContent =
      state.phase === 'playing'
        ? 'Match in progress'
        : state.phase === 'connecting'
          ? 'Connecting…'
          : 'Not connected';
  };

  element.appendChild(lobby);
  renderLobby({ ...INITIAL_MATCH_STATE, phase: 'connecting' });
  void client.connect();

  return {
    element,
    title: 'Versus',
    firstFocus: null,
    destroy: () => {
      destroyGame();
      client?.close();
      client = null;
    },
  };
}

function renderMiniBoard(board: HTMLElement, player: PlayerInfo): void {
  const rows = 10;
  const cols = 10;
  const wanted = rows * cols;
  if (board.childElementCount !== wanted) {
    while (board.firstChild) board.removeChild(board.firstChild);
    for (let i = 0; i < wanted; i++) {
      const cell = document.createElement('span');
      cell.className = 'mini-board__cell';
      board.appendChild(cell);
    }
  }
  const summary = player.board;
  if (!summary) return;
  const children = board.children;
  for (let index = 0; index < wanted; index++) {
    const cell = children[index] as HTMLElement | undefined;
    if (!cell) continue;
    const filled = index < summary.stackHeight * 2 ? 'true' : 'false';
    cell.dataset.filled = filled;
  }
}
