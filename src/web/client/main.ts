import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/baloo-2/latin-400.css';
import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-800.css';
import './styles/main.css';
import { clear, h, svg } from './lib/h.js';
import { describe, setLanguage, t } from './lib/i18n.js';
import { connectLive } from './lib/live.js';
import { api } from './lib/api.js';
import { load, loadAll, onChange, slicesFor, state } from './lib/store.js';
import { toast } from './lib/ui.js';
import { mascotSvg } from './svg/art.js';
import { renderBar } from './views/bar.js';
import { renderRecipes, setRecipeFilterFromHash } from './views/recipes.js';
import { renderActivity, renderGear, renderShopping } from './views/lists.js';

type Route = 'bar' | 'recipes' | 'shopping' | 'gear' | 'activity';
const ROUTES: Route[] = ['bar', 'recipes', 'shopping', 'gear', 'activity'];

const app = document.querySelector<HTMLDivElement>('#app')!;
const main = h('main', { id: 'main', tabIndex: -1 });
let online = true;

function route(): { name: Route; params: URLSearchParams } {
  const [path = '', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const name = (ROUTES.includes(path as Route) ? path : 'bar') as Route;
  return { name, params: new URLSearchParams(query) };
}

function applyTheme(pref: string) {
  if (pref === 'light' || pref === 'dark') document.documentElement.dataset.theme = pref;
  else delete document.documentElement.dataset.theme;
}

function header(): HTMLElement {
  const d = t();
  const current = route().name;
  const settings = (state.meta?.settings ?? {}) as Record<string, string>;
  const select = (key: string, options: [string, string][], value: string, aria: string) =>
    h(
      'label',
      { class: 'pref' },
      h('span', null, aria),
      h(
        'select',
        {
          class: 'mini-select',
          onchange: async (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            await api.settings({ [key]: v });
            await load(['meta']);
            if (key === 'language') setLanguage(v);
            if (key === 'theme') applyTheme(v);
            render();
          },
        },
        options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)),
      ),
    );
  return h(
    'header',
    { class: 'top' },
    h(
      'a',
      { class: 'brand', href: '#/bar' },
      svg(mascotSvg()),
      h(
        'span',
        { class: 'brand-text' },
        h('span', { class: 'wordmark' }, 'Shaky'),
        h('span', { class: 'tagline' }, d.tagline),
      ),
    ),
    h(
      'nav',
      { class: 'tabs', 'aria-label': 'Shaky' },
      ROUTES.map((r) =>
        h(
          'a',
          {
            href: `#/${r}`,
            class: `tab${r === current ? ' is-active' : ''}`,
            'aria-current': r === current ? 'page' : undefined,
          },
          d.nav[r],
        ),
      ),
    ),
    h(
      'div',
      { class: 'prefs' },
      online ? null : h('span', { class: 'offline', role: 'status' }, d.live.offline),
      select(
        'language',
        [
          ['auto', 'Auto'],
          ['en', 'English'],
          ['de', 'Deutsch'],
        ],
        settings.language ?? 'auto',
        d.settings.language,
      ),
      select(
        'theme',
        [
          ['auto', d.settings.auto],
          ['light', d.settings.light],
          ['dark', d.settings.dark],
        ],
        settings.theme ?? 'auto',
        d.settings.theme,
      ),
      select(
        'units',
        [
          ['cl', 'cl'],
          ['oz', 'oz'],
        ],
        settings.units ?? 'cl',
        d.settings.units,
      ),
    ),
  );
}

function render(): void {
  const { name, params } = route();
  const scrollY = window.scrollY;
  clear(app);
  clear(main);
  let view: HTMLElement;
  switch (name) {
    case 'recipes':
      setRecipeFilterFromHash(params);
      view = renderRecipes(render);
      break;
    case 'shopping':
      view = renderShopping();
      break;
    case 'gear':
      view = renderGear();
      break;
    case 'activity':
      view = renderActivity();
      break;
    default:
      view = renderBar();
  }
  main.append(view);
  app.append(
    header(),
    main,
    h('footer', { class: 'foot' }, t().footer, ` | Shaky ${state.meta?.version ?? ''}`),
  );
  window.scrollTo(0, scrollY);
}

let pending: Promise<void> | undefined;
async function boot() {
  await load(['meta']);
  const settings = (state.meta?.settings ?? {}) as Record<string, string>;
  setLanguage(settings.language);
  applyTheme(settings.theme ?? 'auto');
  await loadAll();
  onChange(render);
  window.addEventListener('hashchange', () => {
    render();
    main.focus({ preventScroll: true });
  });
  render();

  connectLive({
    status: (up) => {
      if (up !== online) {
        online = up;
        // After a reconnect, reload everything in case events were missed.
        if (up) void loadAll();
        else render();
      }
    },
    change: (a) => {
      const key = `${a.entity}:${a.entity_id}`;
      state.flash.add(key);
      setTimeout(() => state.flash.delete(key), 1200);
      if (a.source !== 'web') toast(describe(a), a.source === 'mcp' ? 'ai' : 'you');
      pending = (pending ?? Promise.resolve())
        .then(() => load(slicesFor(a.entity)))
        .catch(() => undefined);
    },
  });
}

void boot();
