import { h, svg } from '../lib/h.js';
import { label, t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import { api, type RecipeWithCheck } from '../lib/api.js';
import { attempt, openDialog, toast } from '../lib/ui.js';
import { bottleSvg } from '../svg/art.js';
import { formatAmount } from '../lib/units.js';
import { openRecipeForm } from './recipeForm.js';

type Filter = 'all' | 'makeable' | 'missing_one' | 'missing_more' | 'favorites';
let filter: Filter = 'all';
let search = '';
let tag = '';

export function setRecipeFilterFromHash(params: URLSearchParams): void {
  const s = params.get('status');
  if (s === 'makeable' || s === 'missing_one' || s === 'missing_more') filter = s;
}

const amount = formatAmount;

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
      h('span', { class: `sticker sticker-${st}` }, label(d.recipe.status, st)),
      r.availability.missing.length
        ? h('span', { class: 'missing' }, r.availability.missing.join(', '))
        : null,
    ),
  );
}

export function renderRecipes(rerender: () => void): HTMLElement {
  const d = t();
  const q = search.toLowerCase();
  const list = state.recipes.filter((r) => {
    if (filter === 'favorites' ? !r.favorite : filter !== 'all' && r.availability.status !== filter)
      return false;
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
  });
  const tags = [...new Set(state.recipes.flatMap((r) => r.tags))].sort();
  const count = (f: Filter) =>
    f === 'all'
      ? state.recipes.length
      : f === 'favorites'
        ? state.recipes.filter((r) => r.favorite).length
        : state.recipes.filter((r) => r.availability.status === f).length;
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
        h('span', { class: 'mark', 'aria-hidden': 'true' }, l.status === 'available' ? '✓' : '✗'),
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
          l.match
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
    r.steps.map((s) =>
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
      svg(bottleSvg('other', r.color ?? '#ffb21f', 0.8, 1, r.name)),
      h(
        'div',
        null,
        r.description ? h('p', null, r.description) : null,
        h(
          'p',
          { class: 'muted' },
          [
            r.glass ? `${d.recipe.glass}: ${r.glass.replace(/_/g, ' ')}` : null,
            r.method,
            r.source === 'ai' ? d.recipe.byAI : null,
          ]
            .filter(Boolean)
            .join(', '),
        ),
        h('span', { class: `sticker sticker-${a.status}` }, label(d.recipe.status, a.status)),
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
    r.steps.length ? h('h3', null, d.recipe.steps) : null,
    r.steps.length ? steps : null,
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
