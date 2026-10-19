import { h, svg } from './h.js';
import { t } from './i18n.js';
import { mascotSvg } from '../svg/art.js';

/** Opens a modal dialog. Returns a close function. */
export function openDialog(
  title: string,
  body: Node,
  opts: { wide?: boolean; xwide?: boolean } = {},
): () => void {
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  const dlg = h(
    'dialog',
    {
      class: `sheet${opts.wide ? ' wide' : ''}${opts.xwide ? ' xwide' : ''}`,
      onclose: () => dlg.remove(),
    },
    h(
      'header',
      { class: 'sheet-head' },
      h('h2', null, title),
      h(
        'button',
        { class: 'icon-btn', type: 'button', 'aria-label': t().common.close, onclick: close },
        '×',
      ),
    ),
    body,
  );
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
  document.body.append(dlg);
  dlg.showModal();
  return close;
}

const toastHost = () =>
  document.querySelector('#toasts') ??
  document.body.appendChild(h('div', { id: 'toasts', 'aria-live': 'polite' }));

/** Comic speech bubble from Shaky. AI changes get the talking mascot. */
export function toast(
  text: string,
  kind: 'ai' | 'you' | 'error' = 'you',
  action?: { label: string; run: () => void },
): void {
  const el = h(
    'div',
    { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    kind === 'ai' ? svg(mascotSvg('talk')) : null,
    h(
      'p',
      { class: 'bubble' },
      text,
      action
        ? h(
            'button',
            {
              type: 'button',
              class: 'toast-action',
              onclick: () => {
                el.remove();
                action.run();
              },
            },
            action.label,
          )
        : null,
    ),
  );
  toastHost().append(el);
  // With an action the bubble stays a little longer, so there is time to click.
  const ms = kind === 'error' ? 6000 : action ? 8000 : 4200;
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 600);
}

export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast(`${t().common.error}: ${(e as Error).message}`, 'error');
    return undefined;
  }
}

export function field(labelText: string, input: HTMLElement, hint?: string): HTMLElement {
  return h(
    'label',
    { class: 'field' },
    h('span', null, labelText),
    input,
    hint ? h('small', null, hint) : null,
  );
}

export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
}
