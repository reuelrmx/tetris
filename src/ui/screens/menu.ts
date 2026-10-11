import { ACTIONS, keyLabel } from '../../input/bindings.ts';
import { POSTERS } from '../../data/posters.ts';
import { button, el } from '../dom.ts';
import type { ScreenContext, ScreenInstance } from '../navigation.ts';
import { createPosterStack } from '../poster.ts';
import type { ScreenDeps } from './deps.ts';

/**
 * Title screen.
 *
 * Left column: the wordmark, a one-line explanation and the primary actions. Right column: three
 * board figures from the game itself, crossfading. Below the actions, the four controls a new
 * player needs (move, rotate, hard drop, hold) drawn from their own key bindings, so a rebind is
 * reflected here immediately.
 */
export function createMenuScreen(deps: ScreenDeps, context: ScreenContext): ScreenInstance {
  const posterStack = createPosterStack(POSTERS, Math.min(2, globalThis.devicePixelRatio || 1), 22);

  const bindingLabel = (id: (typeof ACTIONS)[number]['id']): string => {
    const codes = deps.settings.bindings[id];
    return codes.map(keyLabel).join(' or ');
  };

  const actions = el('div', { class: 'menu__actions' }, [
    button('Play', {
      class: 'btn btn--primary btn--lg btn--wide',
      on: { click: () => context.go('modes') },
    }),
    button('How to play', { class: 'btn btn--wide', on: { click: () => context.go('help') } }),
    button('Records', { class: 'btn btn--wide', on: { click: () => context.go('records') } }),
    button('Settings', { class: 'btn btn--wide', on: { click: () => context.go('settings') } }),
  ]);

  const keys = el('div', { class: 'menu__keys' }, [
    keyRow(bindingLabel('moveLeft') + ' / ' + bindingLabel('moveRight'), 'move'),
    keyRow(bindingLabel('rotateCW'), 'rotate clockwise'),
    keyRow(bindingLabel('rotateCCW'), 'rotate anticlockwise'),
    keyRow(bindingLabel('softDrop'), 'soft drop'),
    keyRow(bindingLabel('hardDrop'), 'hard drop'),
    keyRow(bindingLabel('hold'), 'hold'),
    keyRow(bindingLabel('pause'), 'pause'),
  ]);

  const left = el('div', { class: 'menu__intro' }, [
    el('h1', { class: 'menu__title' }, ['STRA', el('span', {}, ['TA'])]),
    el('p', {
      class: 'menu__lede',
      text: 'A falling-block puzzle game with a ten-by-twenty well, seven-bag piece order and SRS rotation. Four modes, online versus, and a complete game offline.',
    }),
    actions,
    el('div', { class: 'menu__keys-title eyebrow', text: 'Controls' }),
    keys,
  ]);

  const element = el('section', { class: 'screen' }, [
    el('div', { class: 'menu' }, [left, posterStack.element]),
  ]);

  return {
    element,
    firstFocus: actions.firstElementChild as HTMLElement | null,
    title: 'Main menu',
    destroy: () => posterStack.destroy(),
  };
}

function keyRow(keys: string, description: string): HTMLElement {
  return el('div', { class: 'menu__key-row' }, [
    el('span', { class: 'menu__key-badge', text: keys }),
    el('span', { class: 'menu__key-desc', text: description }),
  ]);
}
