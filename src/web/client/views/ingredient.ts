import { h, svg } from '../lib/h.js';
import { label, t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import { api, type IngredientView } from '../lib/api.js';
import { attempt, field, openDialog, toast } from '../lib/ui.js';
import { bottleSvg } from '../svg/art.js';
import { badges } from './bar.js';

const LEVELS = ['full', 'three_quarters', 'half', 'quarter', 'almost_empty', 'empty'];
const FRACTIONS = [1, 0.75, 0.5, 0.25, 0.1, 0];

/** Detail sheet with the quick actions: fill level, opened today, archive, edit. */
export function openIngredient(id: number): void {
  const i = state.ingredients.find((x) => x.id === id);
  if (!i) return;
  const d = t();
  let close = () => {};
  const facts = [
    i.brand,
    label(d.categories, i.category),
    i.subcategory,
    i.abv !== null ? `${i.abv} %` : null,
    i.amount_ml !== null
      ? `${i.amount_ml} ml${i.amount_is_estimate ? ` (${d.ing.estimate})` : ''}`
      : null,
    i.expires_on ? d.ing.expiresOn(i.expires_on) : i.opened_at ? d.ing.keepsForever : null,
  ].filter(Boolean);

  const levelButtons = h(
    'div',
    { class: 'level-picker', role: 'group', 'aria-label': d.ing.fill },
    LEVELS.map((lvl) =>
      h(
        'button',
        {
          type: 'button',
          class: `level${lvl === i.fill_level ? ' is-current' : ''}`,
          'aria-pressed': String(lvl === i.fill_level),
          onclick: async () => {
            const r = await attempt(() => api.setFill(i.id, lvl));
            if (r) close();
          },
        },
        svg(bottleSvg('mixer', i.display_color, FRACTIONS[LEVELS.indexOf(lvl)]!, 1, '')),
        h('span', null, label(d.fill, lvl)),
      ),
    ),
  );

  const body = h(
    'div',
    { class: 'sheet-body ing-detail' },
    h(
      'div',
      { class: 'ing-hero' },
      svg(bottleSvg(i.category, i.display_color, i.fill_fraction, i.quantity, i.name)),
      h(
        'div',
        null,
        h('p', { class: 'facts' }, facts.join(', ')),
        h('div', { class: 'badges' }, badges(i)),
        i.flavor_notes ? h('p', { class: 'muted' }, i.flavor_notes) : null,
        i.notes ? h('p', { class: 'muted' }, i.notes) : null,
      ),
    ),
    i.category === 'fruit' || i.category === 'garnish' ? null : h('h3', null, d.ing.fill),
    i.category === 'fruit' || i.category === 'garnish' ? null : levelButtons,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => (await attempt(() => api.open(i.id))) && close(),
        },
        d.ing.openToday,
      ),
      h(
        'button',
        { class: 'btn', type: 'button', onclick: () => (close(), openIngredientForm(i)) },
        d.common.edit,
      ),
      h(
        'button',
        {
          class: 'btn btn-quiet',
          type: 'button',
          onclick: async () => (await attempt(() => api.archive(i.id, i.archived))) && close(),
        },
        i.archived ? d.ing.restore : d.ing.archive,
      ),
    ),
  );
  close = openDialog(i.name, body);
}

const num = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v));
const str = (v: FormDataEntryValue | null) =>
  v === null || String(v).trim() === '' ? null : String(v).trim();

/** Add / edit form. All fields are free; categories and places are suggestions. */
export function openIngredientForm(i?: IngredientView): void {
  const d = t();
  const meta = state.meta;
  const cats = meta?.categories ?? [];
  const catDefault = (c: string) => cats.find((x) => x.category === c);
  let close = () => {};

  const datalist = (id: string, values: { value: string; text: string }[]) =>
    h(
      'datalist',
      { id },
      values.map((v) => h('option', { value: v.value }, v.text)),
    );

  const category = h('input', {
    name: 'category',
    required: true,
    list: 'cat-list',
    value: i?.category ?? 'spirit',
    autocomplete: 'off',
  });
  const location = h('input', {
    name: 'location',
    list: 'loc-list',
    value: i?.location ?? '',
    placeholder: 'shelf',
    autocomplete: 'off',
  });
  const color = h('input', {
    name: 'color',
    type: 'color',
    value: i?.display_color ?? catDefault('spirit')?.color ?? '#d9a441',
  });
  const shelfHint = h(
    'small',
    null,
    d.ing.shelfLifeHint(catDefault(i?.category ?? 'spirit')?.shelf_life_days ?? null),
  );
  category.addEventListener('change', () => {
    const c = catDefault(category.value.toLowerCase());
    if (c && !i) color.value = c.color;
    shelfHint.textContent = d.ing.shelfLifeHint(c?.shelf_life_days ?? null);
  });

  const form = h(
    'form',
    { class: 'sheet-body form-grid' },
    datalist(
      'cat-list',
      cats.map((c) => ({ value: c.category, text: label(d.categories, c.category) })),
    ),
    datalist(
      'loc-list',
      (meta?.locations ?? []).map((l) => ({
        value: l.key,
        text: d.lang === 'de' ? l.label_de : l.label_en,
      })),
    ),
    field(
      d.ing.name,
      h('input', {
        name: 'name',
        required: true,
        value: i?.name ?? '',
        autofocus: true,
        maxLength: 80,
      }),
    ),
    field(d.ing.brand, h('input', { name: 'brand', value: i?.brand ?? '' })),
    field(d.ing.category, category),
    field(
      d.ing.subcategory,
      h('input', {
        name: 'subcategory',
        value: i?.subcategory ?? '',
        placeholder: d.ing.subcategoryHint,
      }),
    ),
    field(d.ing.location, location),
    field(d.ing.color, color),
    field(
      d.ing.fill,
      h(
        'select',
        { name: 'fill_level' },
        LEVELS.map((l) =>
          h('option', { value: l, selected: l === (i?.fill_level ?? 'full') }, label(d.fill, l)),
        ),
      ),
    ),
    field(
      d.ing.quantity,
      h('input', {
        name: 'quantity',
        type: 'number',
        min: 0,
        step: 'any',
        value: String(i?.quantity ?? 1),
      }),
    ),
    field(
      d.ing.bottle,
      h('input', {
        name: 'bottle_size_ml',
        type: 'number',
        min: 1,
        value: i?.bottle_size_ml ?? '',
      }),
    ),
    field(
      d.ing.amount,
      h('input', {
        name: 'amount_ml',
        type: 'number',
        min: 0,
        value: i && !i.amount_is_estimate ? (i.amount_ml ?? '') : '',
      }),
    ),
    field(
      d.ing.abv,
      h('input', {
        name: 'abv',
        type: 'number',
        min: 0,
        max: 100,
        step: 'any',
        value: i?.abv ?? '',
      }),
    ),
    field(
      d.ing.yield,
      h('input', { name: 'yield_ml', type: 'number', min: 1, value: i?.yield_ml ?? '' }),
    ),
    field(
      d.ing.opened,
      h('input', { name: 'opened_at', type: 'date', value: i?.opened_at?.slice(0, 10) ?? '' }),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', null, d.ing.shelfLife),
      h('input', {
        name: 'shelf_life_days',
        type: 'number',
        min: 1,
        value: i?.shelf_life_days ?? '',
      }),
      shelfHint,
    ),
    field(
      d.ing.expires,
      h('input', { name: 'expires_at', type: 'date', value: i?.expires_at?.slice(0, 10) ?? '' }),
    ),
    field(
      d.ing.tags,
      h('input', { name: 'tags', value: i?.tags.join(', ') ?? '', placeholder: d.ing.tagsHint }),
    ),
    h(
      'label',
      { class: 'field span-2' },
      h('span', null, d.ing.flavor),
      h('input', { name: 'flavor_notes', value: i?.flavor_notes ?? '' }),
    ),
    h(
      'label',
      { class: 'field span-2' },
      h('span', null, d.ing.notes),
      h('textarea', { name: 'notes', rows: 2, value: i?.notes ?? '' }),
    ),
    h(
      'div',
      { class: 'actions span-2' },
      h(
        'button',
        { class: 'btn btn-quiet', type: 'button', onclick: () => close() },
        d.common.cancel,
      ),
      h('button', { class: 'btn btn-primary', type: 'submit' }, d.ing.save),
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const amount = num(f.get('amount_ml'));
    const level = String(f.get('fill_level'));
    const payload: Record<string, unknown> = {
      name: str(f.get('name')),
      brand: str(f.get('brand')),
      category: str(f.get('category')) ?? 'other',
      subcategory: str(f.get('subcategory')),
      location: str(f.get('location')) ?? undefined,
      color: String(f.get('color')),
      quantity: num(f.get('quantity')) ?? 1,
      bottle_size_ml: num(f.get('bottle_size_ml')),
      abv: num(f.get('abv')),
      yield_ml: num(f.get('yield_ml')),
      opened_at: str(f.get('opened_at')),
      shelf_life_days: num(f.get('shelf_life_days')),
      expires_at: str(f.get('expires_at')),
      tags: String(f.get('tags') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      flavor_notes: str(f.get('flavor_notes')),
      notes: str(f.get('notes')),
    };
    // Only send what the user actually changed about the level, so an exact ml figure is kept.
    if (amount !== null) payload.amount_ml = amount;
    else if (!i || level !== i.fill_level) payload.fill_level = level;
    const r = await attempt(() =>
      i ? api.updateIngredient(i.id, payload) : api.addIngredient(payload),
    );
    if (r) {
      close();
      toast(`${r.result.name} ✓`);
    }
  });

  close = openDialog(i ? i.name : d.ing.newTitle, form, { wide: true });
}
