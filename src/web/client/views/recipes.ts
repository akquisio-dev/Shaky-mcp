import { h, svg } from '../lib/h.js';
import { label, t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import { api, type RecipeWithCheck } from '../lib/api.js';
import { attempt, openDialog, toast } from '../lib/ui.js';
import { filledGlassSvg } from '../game/art.js';
import { formatAmount } from '../lib/units.js';
import { openRecipeForm } from './recipeForm.js';
import { openBatch } from './batch.js';

type Filter =
  | 'all'
  | 'makeable'
  | 'with_substitute'
  | 'missing_one'
  | 'missing_more'
  | 'favorites'
  | 'alcohol_free'
  | 'use_up';
let filter: Filter = 'all';
let search = '';
let tag = '';

let openedFromHash = '';

export function setRecipeFilterFromHash(params: URLSearchParams, rerender: () => void): void {
  const s = params.get('status');
  if (
    s === 'makeable' ||
    s === 'with_substitute' ||
    s === 'missing_one' ||
    s === 'missing_more' ||
    s === 'use_up'
  )
    filter = s;
  // #/recipes?open=<id> opens that recipe once (used when the AI shows a recipe).
  const open = params.get('open');
  if (open && open !== openedFromHash) {
    openedFromHash = open;
    queueMicrotask(() => void openRecipe(Number(open), rerender));
  } else if (!open) openedFromHash = '';
}

const amount = formatAmount;

const usableStatus = (st: string) => st === 'makeable' || st === 'with_substitute';

function card(r: RecipeWithCheck, rerender: () => void): HTMLElement {
  const d = t();
  const st = r.availability.status;
  return h(
    'button',
    {
      class: `recipe-card status-${st}${state.flash.has(`recipe:${r.id}`) ? ' wobble' : ''}`,
      type: 'button',
      onclick: () => openRecipe(r.id, rerender),
    },
    h('span', { class: 'swatch', style: { background: r.color ?? 'var(--mango)' } }),
    h(
      'span',
      { class: 'recipe-main' },
      h('span', { class: 'recipe-name' }, r.favorite ? '★ ' : '', r.name),
      r.description ? h('span', { class: 'recipe-desc' }, r.description) : null,
      h(
        'span',
        { class: 'tags' },
        r.tags.slice(0, 4).map((x) => h('span', { class: 'tag' }, x)),
      ),
    ),
    h(
      'span',
      { class: 'recipe-side' },
      h(
        'span',
        { class: `sticker sticker-${st}` },
        label(d.recipe.status, st),
        usableStatus(st) && r.availability.servings_possible !== null
          ? ` ${r.availability.servings_possible}×`
          : '',
      ),
      r.availability.missing.length
        ? h('span', { class: 'missing' }, r.availability.missing.join(', '))
        : null,
      r.personal.avoided.length ? h('span', { class: 'badge b-low' }, d.recipe.avoided) : null,
      r.alcohol_free
        ? h('span', { class: 'badge b-open' }, d.recipe.noAlcohol)
        : r.strength.abv > 0
          ? h('span', { class: 'muted abv' }, `${fmtNum(r.strength.abv)} %`)
          : null,
      r.availability.uses_expiring.length && usableStatus(st)
        ? h('span', { class: 'badge b-soon' }, d.recipe.useUpBadge)
        : null,
    ),
  );
}

const money = (x: number, cur: string) =>
  new Intl.NumberFormat(t().lang, { style: 'currency', currency: cur }).format(x);

const fmtNum = (x: number) => String(x).replace('.', t().lang === 'de' ? ',' : '.');

export function renderRecipes(rerender: () => void): HTMLElement {
  const d = t();
  const q = search.toLowerCase();
  const usable = (r: (typeof state.recipes)[number]) =>
    r.availability.status === 'makeable' || r.availability.status === 'with_substitute';
  const matches = (r: (typeof state.recipes)[number], f: Filter) =>
    f === 'all'
      ? true
      : f === 'favorites'
        ? r.favorite
        : f === 'alcohol_free'
          ? r.alcohol_free
          : f === 'use_up'
            ? usable(r) && r.availability.uses_expiring.length > 0
            : r.availability.status === f;
  const list = state.recipes
    .filter((r) => {
      if (!matches(r, filter)) return false;
      if (tag && !r.tags.includes(tag)) return false;
      if (
        q &&
        ![r.name, r.description ?? '', ...r.tags, ...r.ingredients.map((x) => x.name)]
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    })
    .sort((a, b) =>
      filter === 'use_up'
        ? (a.availability.uses_expiring[0]?.days_left ?? 99) -
          (b.availability.uses_expiring[0]?.days_left ?? 99)
        : 0,
    );
  const tags = [...new Set(state.recipes.flatMap((r) => r.tags))].sort();
  const count = (f: Filter) => state.recipes.filter((r) => matches(r, f)).length;
  const chip = (f: Filter, text: string) =>
    h(
      'button',
      {
        type: 'button',
        class: `chip${filter === f ? ' is-on' : ''}`,
        'aria-pressed': String(filter === f),
        onclick: () => ((filter = f), rerender()),
      },
      text,
      h('span', { class: 'n' }, count(f)),
    );

  const searchInput = h('input', {
    type: 'search',
    class: 'search',
    placeholder: d.recipe.search,
    value: search,
    'aria-label': d.recipe.search,
    oninput: (e: Event) => {
      search = (e.target as HTMLInputElement).value;
      const pos = (e.target as HTMLInputElement).selectionStart;
      rerender();
      const again = document.querySelector<HTMLInputElement>('input.search');
      again?.focus();
      if (pos !== null) again?.setSelectionRange(pos, pos);
    },
  });

  return h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'toolbar' },
      h(
        'div',
        { class: 'toolbar-row' },
        searchInput,
        h(
          'button',
          { class: 'btn btn-primary', type: 'button', onclick: () => openRecipeForm() },
          `+ ${d.form.newRecipe}`,
        ),
      ),
      h(
        'div',
        { class: 'chips' },
        chip('all', d.recipe.all),
        chip('makeable', d.recipe.makeable),
        chip('missing_one', d.recipe.missingOne),
        chip('missing_more', d.recipe.missingMore),
        chip('with_substitute', d.recipe.withSubstitute),
        chip('use_up', d.recipe.useUp),
        chip('alcohol_free', d.recipe.alcoholFree),
        chip('favorites', d.recipe.favorites),
      ),
      h(
        'div',
        { class: 'chips tags-filter' },
        tags.map((x) =>
          h(
            'button',
            {
              type: 'button',
              class: `tag${tag === x ? ' is-on' : ''}`,
              onclick: () => ((tag = tag === x ? '' : x), rerender()),
            },
            x,
          ),
        ),
      ),
    ),
    list.length
      ? h(
          'div',
          { class: 'recipe-list' },
          list.map((r) => card(r, rerender)),
        )
      : h('p', { class: 'empty-state' }, d.recipe.none),
  );
}

export async function openRecipe(id: number, rerender: () => void): Promise<void> {
  const r = state.recipes.find((x) => x.id === id) ?? (await attempt(() => api.recipe(id)));
  if (!r) return;
  const d = t();
  const a = r.availability;
  let close = () => {};
  const deduct = h('input', { type: 'checkbox', checked: true });

  const lines = h(
    'ul',
    { class: 'ing-lines' },
    a.lines.map((l) =>
      h(
        'li',
        { class: `line line-${l.status}` },
        h(
          'span',
          { class: 'mark', 'aria-hidden': 'true' },
          l.status === 'available' ? '✓' : l.status === 'substituted' ? '≈' : '✗',
        ),
        h('span', { class: 'amt' }, amount(l.amount, l.unit)),
        h(
          'span',
          { class: 'what' },
          l.name,
          l.optional ? h('em', null, ` (${d.recipe.optional})`) : null,
          l.garnish ? h('em', null, ` (${d.recipe.garnish})`) : null,
        ),
        h(
          'span',
          { class: 'src' },
          l.substitute
            ? d.recipe.insteadOf(l.substitute.using, l.substitute.note)
            : l.match
              ? l.match.name
              : l.status === 'unavailable'
                ? d.recipe.unusable
                : d.recipe.missing,
        ),
      ),
    ),
  );

  const steps = h(
    'ol',
    { class: 'steps' },
    r.personal.steps.map((s) =>
      h(
        'li',
        null,
        h('strong', null, label(d.recipe.actions, s.action)),
        s.ingredient ? ` ${amount(s.amount, s.unit)} ${s.ingredient}` : '',
        s.duration_s ? ` (${s.duration_s} s)` : '',
        s.note ? h('span', { class: 'muted' }, ` ${s.note}`) : null,
      ),
    ),
  );

  const missingAll = a.lines
    .filter((l) => l.status !== 'available' && !l.garnish)
    .map((l) => l.name);
  const body = h(
    'div',
    { class: 'sheet-body recipe-detail' },
    h(
      'div',
      { class: 'recipe-hero' },
      svg(filledGlassSvg(r.glass, r.color ?? '#ffb21f', r.name)),
      h(
        'div',
        null,
        r.description ? h('p', null, r.description) : null,
        h(
          'p',
          { class: 'muted' },
          [
            r.glass ? `${d.recipe.glass}: ${label(d.game.glasses, r.glass)}` : null,
            r.method ? label(d.methods, r.method.toLowerCase()) : null,
            r.source === 'ai' ? d.recipe.byAI : null,
          ]
            .filter(Boolean)
            .join(', '),
        ),
        h(
          'span',
          { class: `sticker sticker-${a.status}` },
          label(d.recipe.status, a.status),
          a.status === 'makeable' && a.servings_possible !== null ? ` ${a.servings_possible}×` : '',
        ),
        a.status === 'makeable' && a.servings_possible !== null
          ? h('span', { class: 'muted small-note' }, d.recipe.servingsLeft(a.servings_possible))
          : null,
        h(
          'button',
          {
            class: 'icon-btn star',
            type: 'button',
            'aria-pressed': String(r.favorite),
            'aria-label': d.recipe.favorites,
            onclick: async () =>
              (await attempt(() => api.recipeFlags(r.id, { favorite: !r.favorite }))) && close(),
          },
          r.favorite ? '★' : '☆',
        ),
      ),
    ),
    h('h3', null, d.recipe.ingredients),
    lines,
    a.missing_equipment.length || a.substitutes_used.length
      ? h(
          'p',
          { class: 'gear-note' },
          a.missing_equipment.length
            ? `${d.recipe.missingEquipment}: ${a.missing_equipment.join(', ')}. `
            : '',
          a.substitutes_used.map((s) => d.recipe.using(s.type, s.using)).join(', '),
        )
      : null,
    r.personal.adjustments.length
      ? h(
          'p',
          { class: 'personal-note' },
          d.recipe.yourWay,
          ' ',
          r.personal.adjustments
            .map((x) => `${x.line} ${formatAmount(x.from, x.unit)} → ${formatAmount(x.to, x.unit)}`)
            .join(', '),
        )
      : null,
    r.personal.avoided.length
      ? h('p', { class: 'gear-note' }, d.recipe.avoidedNote(r.personal.avoided.join(', ')))
      : null,
    r.availability.uses_expiring.length
      ? h(
          'p',
          { class: 'use-up-note' },
          d.recipe.usesUp(
            r.availability.uses_expiring
              .map((u) => `${u.bottle} (${t().badge.useIn(u.days_left)})`)
              .join(', '),
          ),
        )
      : null,
    r.cost.amount > 0
      ? h(
          'p',
          { class: 'muted' },
          d.recipe.cost(money(r.cost.amount, r.cost.currency), r.cost.complete),
        )
      : null,
    r.strength.abv > 0
      ? h(
          'p',
          { class: 'strength' },
          d.recipe.strength(fmtNum(r.strength.abv), fmtNum(r.strength.standard_drinks)),
          r.strength.energy ? h('strong', { class: 'energy' }, ` ${d.recipe.energy}`) : null,
        )
      : null,
    r.personal.steps.length ? h('h3', null, d.recipe.steps) : null,
    r.personal.steps.length ? steps : null,
    h(
      'div',
      { class: 'actions' },
      missingAll.length
        ? h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: async () => {
                for (const name of missingAll)
                  await attempt(() => api.addShopping({ name, reason: r.name }));
                toast(t().shopping.added(missingAll.join(', ')));
              },
            },
            d.recipe.toShopping,
          )
        : null,
      h(
        'a',
        { class: 'btn', href: `#/mix?recipe=${r.id}`, onclick: () => close() },
        d.recipe.practice,
      ),
      h('a', { class: 'btn', href: `#/make?recipe=${r.id}`, onclick: () => close() }, d.make.open),
      h('button', { class: 'btn', type: 'button', onclick: () => openBatch(r) }, d.batch.open),
      h('label', { class: 'check' }, deduct, d.recipe.deduct),
      h(
        'button',
        {
          class: 'btn btn-primary btn-big',
          type: 'button',
          onclick: async () => {
            const res = await attempt(() => api.mix({ recipe: r.id, deduct: deduct.checked }));
            if (res) {
              close();
              toast(d.recipe.mixedDone(r.name));
            }
          },
        },
        d.recipe.mixed,
      ),
    ),
    h(
      'button',
      {
        class: 'btn btn-quiet btn-small',
        type: 'button',
        onclick: () => (close(), openRecipeForm(r)),
      },
      d.common.edit,
    ),
    ' ',
    h(
      'button',
      {
        class: 'btn btn-quiet btn-small',
        type: 'button',
        onclick: async () => {
          if (
            confirm(d.recipe.confirmDelete(r.name)) &&
            (await attempt(() => api.deleteRecipe(r.id)))
          ) {
            close();
            rerender();
          }
        },
      },
      d.recipe.delete,
    ),
  );
  close = openDialog(r.name, body, { wide: true });
}
