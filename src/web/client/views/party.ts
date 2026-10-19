import { h, svg } from '../lib/h.js';
import { label, t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import { api, type PartyPlan } from '../lib/api.js';
import { attempt, field, toast } from '../lib/ui.js';
import { formatAmount } from '../lib/units.js';
import { filledGlassSvg } from '../game/art.js';

// Party mode: pick drinks, say how many guests, get amounts, shopping, ice,
// cost and a printable drinks menu.

const chosen = new Set<number>();
let guests = 8;
let perGuest = 2;
let when = '';
let diets = new Set<string>();
let dietNames: string[] | null = null;
let plan: PartyPlan | null = null;

const money = (x: number, cur: string) =>
  new Intl.NumberFormat(t().lang, { style: 'currency', currency: cur }).format(x);

function body() {
  return {
    guests,
    drinks_per_guest: perGuest,
    recipes: [...chosen],
    diets: [...diets],
    ...(when && { party_at: new Date(when).toISOString() }),
  };
}

async function run(rerender: () => void) {
  if (!chosen.size) {
    plan = null;
    return rerender();
  }
  const r = await attempt(() => api.party(body()));
  if (r) {
    plan = r;
    rerender();
  }
}

export function renderParty(rerender: () => void): HTMLElement {
  const d = t().party;
  if (dietNames === null) {
    dietNames = [];
    void api.diets().then((rules) => {
      dietNames = [...new Set(rules.map((r) => r.diet))];
      rerender();
    });
  }
  const recipes = [...state.recipes].sort(
    (a, b) =>
      Number(b.availability.status === 'makeable') - Number(a.availability.status === 'makeable') ||
      a.name.localeCompare(b.name),
  );
  const num = (value: number, onchange: (n: number) => void, attrs: Record<string, unknown> = {}) =>
    h('input', {
      type: 'number',
      value: String(value),
      ...attrs,
      onchange: (e: Event) => {
        onchange(Number((e.target as HTMLInputElement).value) || 1);
        void run(rerender);
      },
    });

  const setup = h(
    'section',
    { class: 'paper party-setup' },
    h(
      'div',
      { class: 'form-grid' },
      field(
        d.guests,
        num(guests, (n) => (guests = n), { min: 1, max: 500 }),
      ),
      field(
        d.perGuest,
        num(perGuest, (n) => (perGuest = n), { min: 1, max: 20, step: '0.5' }),
      ),
      field(
        d.when,
        h('input', {
          type: 'datetime-local',
          value: when,
          onchange: (e: Event) => {
            when = (e.target as HTMLInputElement).value;
            void run(rerender);
          },
        }),
      ),
      h(
        'div',
        { class: 'field' },
        h('span', null, d.diets),
        h(
          'div',
          { class: 'chips' },
          (dietNames ?? []).map((x) =>
            h(
              'button',
              {
                type: 'button',
                class: `chip${diets.has(x) ? ' is-on' : ''}`,
                'aria-pressed': String(diets.has(x)),
                onclick: () => {
                  if (diets.has(x)) diets.delete(x);
                  else diets.add(x);
                  diets = new Set(diets);
                  void run(rerender);
                },
              },
              label(d.dietNames, x),
            ),
          ),
        ),
      ),
    ),
    h('h3', null, d.pick),
    h(
      'div',
      { class: 'party-picks' },
      recipes.map((r) =>
        h(
          'label',
          { class: `pick${chosen.has(r.id) ? ' is-on' : ''}` },
          h('input', {
            type: 'checkbox',
            checked: chosen.has(r.id),
            onchange: () => {
              if (chosen.has(r.id)) chosen.delete(r.id);
              else chosen.add(r.id);
              void run(rerender);
            },
          }),
          h('span', { class: 'pick-name' }, r.name),
          h(
            'span',
            { class: `sticker sticker-${r.availability.status}` },
            label(t().recipe.status, r.availability.status),
          ),
          r.alcohol_free ? h('span', { class: 'badge b-open' }, t().recipe.noAlcohol) : null,
        ),
      ),
    ),
  );

  if (!plan)
    return h('div', { class: 'view party' }, setup, h('p', { class: 'empty-state' }, d.choose));
  const p = plan;
  const fmtTime = new Intl.DateTimeFormat(t().lang, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const result = h(
    'div',
    { class: 'party-result' },
    h(
      'section',
      { class: 'paper' },
      h('h2', null, d.drinks(p.total_drinks, p.guests)),
      h(
        'ul',
        { class: 'gear-list' },
        p.drinks.map((x) =>
          h(
            'li',
            null,
            h(
              'span',
              { class: 'gear-name' },
              `${x.servings}× ${x.name}`,
              x.replaced.length
                ? h('small', null, x.replaced.map((r) => d.replaced(r.with, r.line)).join(', '))
                : null,
            ),
            x.not_for.length
              ? h(
                  'span',
                  { class: 'badge b-low' },
                  d.notFor(x.not_for.map((b) => label(d.dietNames, b.diet)).join(', ')),
                )
              : null,
          ),
        ),
      ),
      h('p', { class: 'strength' }, d.cost(money(p.cost.amount, p.cost.currency), p.cost.complete)),
    ),
    h(
      'section',
      { class: 'paper' },
      h('h2', null, d.amounts),
      h(
        'ul',
        { class: 'ing-lines' },
        p.ingredients.map((i) =>
          h(
            'li',
            { class: `line ${i.enough ? 'line-available' : 'line-missing'}` },
            h('span', { class: 'mark' }, i.enough ? '✓' : '✗'),
            h(
              'span',
              { class: 'amt' },
              i.need_ml !== undefined
                ? formatAmount(Math.round(i.need_ml / 10), 'cl')
                : `${i.need_pieces} ${i.unit ?? ''}`,
            ),
            h('span', { class: 'what' }, i.name),
            h(
              'span',
              { class: 'src' },
              i.need_ml !== undefined && i.have_ml !== null && i.have_ml !== undefined
                ? d.have(formatAmount(Math.round(i.have_ml / 10), 'cl'))
                : '',
            ),
          ),
        ),
      ),
      p.shopping.length
        ? h(
            'div',
            { class: 'actions' },
            h(
              'p',
              { class: 'muted' },
              `${d.toBuy}: ${p.shopping.map((s) => `${s.name} (${s.quantity})`).join(', ')}`,
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-primary',
                onclick: async () => {
                  const r = await attempt(() => api.partyShopping({ ...body(), reason: d.reason }));
                  if (r) toast(t().shopping.added(p.shopping.map((s) => s.name).join(', ')));
                },
              },
              d.addShopping,
            ),
          )
        : h('p', { class: 'strength' }, d.allThere),
    ),
    h(
      'section',
      { class: 'paper' },
      h('h2', null, d.ice),
      h(
        'p',
        null,
        d.iceNeed(p.ice.cubes_needed, p.ice.crushed_portions_needed),
        ' ',
        p.ice.tracked
          ? d.iceHave(p.ice.cubes_in_stock, p.ice.crushed_in_stock, p.ice.large_in_stock)
          : d.iceUntracked,
      ),
      p.ice.cubes_short > 0
        ? h(
            'p',
            { class: p.ice.too_late ? 'gear-note' : 'strength' },
            d.iceShort(p.ice.cubes_short, p.ice.freeze_hours),
            p.ice.start_freezing_by
              ? ` ${d.startBy(fmtTime.format(new Date(p.ice.start_freezing_by)))}`
              : '',
            p.ice.too_late ? ` ${d.tooLate}` : '',
          )
        : h('p', { class: 'strength' }, d.iceOk),
    ),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-big', onclick: () => window.print() }, d.print),
    ),
  );

  // The printable menu: only this is visible when printing.
  const menu = h(
    'section',
    { class: 'print-menu', 'aria-hidden': 'true' },
    h('h1', null, d.menuTitle),
    when
      ? h(
          'p',
          { class: 'menu-when' },
          new Intl.DateTimeFormat(t().lang, { dateStyle: 'full', timeStyle: 'short' }).format(
            new Date(when),
          ),
        )
      : null,
    h(
      'div',
      { class: 'menu-items' },
      p.drinks.map((x) =>
        h(
          'article',
          { class: 'menu-item' },
          svg(filledGlassSvg(x.glass, x.color ?? '#ffb21f', x.name)),
          h(
            'div',
            null,
            h('h2', null, x.name),
            x.description ? h('p', null, x.description) : null,
            h(
              'p',
              { class: 'menu-meta' },
              x.alcohol_free
                ? t().recipe.noAlcohol
                : `${String(x.abv).replace('.', t().lang === 'de' ? ',' : '.')} %`,
              x.not_for.length
                ? ` | ${d.notFor(x.not_for.map((b) => label(d.dietNames, b.diet)).join(', '))}`
                : '',
              x.replaced.length
                ? ` | ${x.replaced
                    .map((r) => label(d.dietNames, r.diet))
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .join(', ')}`
                : '',
            ),
          ),
        ),
      ),
    ),
    h('p', { class: 'menu-foot' }, t().footer.split('|')[0]),
  );

  return h('div', { class: 'view party' }, setup, result, menu);
}
