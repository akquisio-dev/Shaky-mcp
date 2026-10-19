import { h } from '../lib/h.js';
import { label, t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import { api, type RecipeWithCheck } from '../lib/api.js';
import { attempt, field, openDialog, toast } from '../lib/ui.js';

interface IngRow {
  name: string;
  category?: string;
  subcategory?: string;
  amount?: number;
  unit: string;
  optional: boolean;
  garnish: boolean;
  exact?: boolean;
  exclude?: string[];
}

interface StepRow {
  action: string;
  ingredient?: string;
  amount?: number;
  unit?: string;
  equipment?: string;
  duration_s?: number;
  note?: string;
}

const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
const strOrUndef = (v: string) => (v.trim() === '' ? undefined : v.trim());

/** Suggests steps from the ingredient list and method, as a starting point. */
export function draftSteps(ings: IngRow[], method: string): StepRow[] {
  const m = method.toLowerCase();
  const pours = ings.filter((i) => !i.garnish);
  const garnishes = ings.filter((i) => i.garnish);
  const into = m.includes('shak') ? 'shaker' : m.includes('blend') ? 'blender' : undefined;
  const steps: StepRow[] = [];
  if (!into) steps.push({ action: 'add_ice' });
  for (const i of pours) {
    const top = !into && i === pours[pours.length - 1] && pours.length > 1;
    steps.push({
      action: top ? 'top_up' : 'pour',
      ingredient: i.name,
      amount: i.amount,
      unit: i.unit,
      equipment: into,
    });
  }
  if (into === 'shaker')
    steps.push(
      { action: 'add_ice', equipment: 'shaker' },
      { action: 'shake', duration_s: 12 },
      { action: 'strain' },
    );
  else if (into === 'blender')
    steps.push(
      { action: 'add_ice', equipment: 'blender' },
      { action: 'blend', duration_s: 20 },
      { action: 'pour' },
    );
  else if (m.includes('stir'))
    steps.push({ action: 'stir', equipment: 'bar_spoon', duration_s: 15 });
  for (const g of garnishes) steps.push({ action: 'garnish', ingredient: g.name });
  return steps;
}

/** Create or edit a recipe, including structured steps for the game. */
export function openRecipeForm(r?: RecipeWithCheck): void {
  const d = t();
  const meta = state.meta;
  let close = () => {};
  const ings: IngRow[] = r
    ? r.ingredients.map((i) => ({ ...i }))
    : [{ name: '', unit: 'cl', optional: false, garnish: false }];
  const steps: StepRow[] = r ? r.steps.map((s) => ({ ...s })) : [];

  const units = meta?.units ?? ['cl'];
  const actions = meta?.step_actions ?? ['pour'];
  const cats = meta?.categories.map((c) => c.category) ?? [];

  const ingBox = h('div', { class: 'rows' });
  const stepBox = h('div', { class: 'rows' });

  const sel = (
    values: string[],
    value: string | undefined,
    onchange: (v: string) => void,
    names?: Record<string, string>,
    empty = false,
  ) =>
    h(
      'select',
      { onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
      empty ? h('option', { value: '' }, '') : null,
      values.map((v) =>
        h(
          'option',
          { value: v, selected: v === value },
          names ? label(names, v) : v.replace(/_/g, ' '),
        ),
      ),
    );
  const inp = (
    value: unknown,
    onchange: (v: string) => void,
    attrs: Record<string, unknown> = {},
  ) =>
    h('input', {
      value: value === undefined ? '' : String(value),
      oninput: (e: Event) => onchange((e.target as HTMLInputElement).value),
      ...attrs,
    });
  const move = <T>(list: T[], i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
  };

  function drawIngs() {
    ingBox.replaceChildren(
      ...ings.map((row, i) =>
        h(
          'div',
          { class: 'row ing-row' },
          inp(row.name, (v) => (row.name = v), {
            placeholder: d.form.ingName,
            'aria-label': d.form.ingName,
            required: true,
          }),
          inp(row.subcategory, (v) => (row.subcategory = strOrUndef(v)), {
            placeholder: d.form.matches,
            'aria-label': d.form.matches,
          }),
          sel(cats, row.category, (v) => (row.category = strOrUndef(v)), d.categories, true),
          inp(row.amount, (v) => (row.amount = numOrUndef(v)), {
            type: 'text',
            inputMode: 'decimal',
            class: 'num',
            'aria-label': d.form.amount,
            placeholder: '4',
          }),
          sel(units, row.unit, (v) => (row.unit = v)),
          h(
            'label',
            { class: 'check small' },
            h('input', {
              type: 'checkbox',
              checked: row.optional,
              onchange: (e: Event) => (row.optional = (e.target as HTMLInputElement).checked),
            }),
            d.recipe.optional,
          ),
          h(
            'label',
            { class: 'check small' },
            h('input', {
              type: 'checkbox',
              checked: row.garnish,
              onchange: (e: Event) => (row.garnish = (e.target as HTMLInputElement).checked),
            }),
            d.recipe.garnish,
          ),
          h(
            'label',
            { class: 'check small', title: d.form.exactHint },
            h('input', {
              type: 'checkbox',
              checked: Boolean(row.exact),
              onchange: (e: Event) =>
                (row.exact = (e.target as HTMLInputElement).checked || undefined),
            }),
            d.form.exact,
          ),
          inp(
            row.exclude?.join(', '),
            (v) => {
              const list = v
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean);
              row.exclude = list.length ? list : undefined;
            },
            { placeholder: d.form.excludePh, 'aria-label': d.form.exclude, class: 'exclude' },
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              'aria-label': d.gear.remove,
              onclick: () => (ings.splice(i, 1), drawIngs()),
            },
            '×',
          ),
        ),
      ),
    );
  }

  function drawSteps() {
    const names = ings.map((i) => i.name).filter(Boolean);
    stepBox.replaceChildren(
      ...steps.map((s, i) =>
        h(
          'div',
          { class: 'row step-row' },
          h('span', { class: 'step-n' }, String(i + 1)),
          sel(actions, s.action, (v) => (s.action = v), d.recipe.actions),
          sel(names, s.ingredient, (v) => (s.ingredient = strOrUndef(v)), undefined, true),
          inp(s.amount, (v) => (s.amount = numOrUndef(v)), {
            class: 'num',
            inputMode: 'decimal',
            'aria-label': d.form.amount,
          }),
          sel(units, s.unit, (v) => (s.unit = strOrUndef(v)), undefined, true),
          inp(s.equipment, (v) => (s.equipment = strOrUndef(v)), {
            placeholder: d.gear.type,
            list: 'eq-types-form',
            'aria-label': d.gear.type,
          }),
          inp(s.duration_s, (v) => (s.duration_s = numOrUndef(v)), {
            class: 'num',
            placeholder: 's',
            'aria-label': d.form.seconds,
          }),
          inp(s.note, (v) => (s.note = strOrUndef(v)), {
            placeholder: d.ing.notes,
            class: 'note',
            'aria-label': d.ing.notes,
          }),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              'aria-label': d.form.up,
              onclick: () => (move(steps, i, -1), drawSteps()),
            },
            '↑',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              'aria-label': d.form.down,
              onclick: () => (move(steps, i, 1), drawSteps()),
            },
            '↓',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              'aria-label': d.gear.remove,
              onclick: () => (steps.splice(i, 1), drawSteps()),
            },
            '×',
          ),
        ),
      ),
    );
  }

  const name = h('input', { name: 'name', required: true, value: r?.name ?? '', maxLength: 80 });
  const desc = h('input', { name: 'description', value: r?.description ?? '' });
  const tags = h('input', {
    name: 'tags',
    value: r?.tags.join(', ') ?? '',
    placeholder: 'fruity, tiki, longdrink',
  });
  const glass = h('input', { name: 'glass', value: r?.glass ?? '', list: 'glass-types-form' });
  const method = h('input', {
    name: 'method',
    value: r?.method ?? '',
    placeholder: 'shaken, stirred, built, blended',
  });
  const color = h('input', { name: 'color', type: 'color', value: r?.color ?? '#ffb21f' });

  const form = h(
    'form',
    { class: 'sheet-body recipe-form' },
    h(
      'datalist',
      { id: 'glass-types-form' },
      (meta?.glass_types ?? []).map((g) => h('option', { value: g })),
    ),
    h(
      'datalist',
      { id: 'eq-types-form' },
      (meta?.equipment_types ?? []).map((g) => h('option', { value: g })),
    ),
    h(
      'div',
      { class: 'form-grid' },
      field(d.ing.name, name),
      field(d.form.glass, glass),
      h('label', { class: 'field span-2' }, h('span', null, d.form.description), desc),
      field(d.ing.tags, tags),
      field(d.form.method, method),
      field(d.form.color, color),
    ),
    h('h3', null, d.recipe.ingredients),
    h('p', { class: 'muted small' }, d.form.matchHint),
    h(
      'div',
      { class: 'ing-head', 'aria-hidden': 'true' },
      h('span', null, d.form.ingName),
      h('span', null, d.form.matchesShort),
      h('span', null, d.ing.category),
      h('span', null, d.form.amount),
    ),
    ingBox,
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small',
        onclick: () => (
          ings.push({ name: '', unit: 'cl', optional: false, garnish: false }),
          drawIngs()
        ),
      },
      `+ ${d.form.addIng}`,
    ),
    h('h3', null, d.recipe.steps),
    stepBox,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small',
          onclick: () => (steps.push({ action: 'pour' }), drawSteps()),
        },
        `+ ${d.form.addStep}`,
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small btn-quiet',
          onclick: () => {
            steps.splice(
              0,
              steps.length,
              ...draftSteps(
                ings.filter((i) => i.name),
                method.value,
              ),
            );
            drawSteps();
          },
        },
        d.form.draft,
      ),
    ),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        { class: 'btn btn-quiet', type: 'button', onclick: () => close() },
        d.common.cancel,
      ),
      h('button', { class: 'btn btn-primary', type: 'submit' }, d.form.save),
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: name.value,
      description: desc.value || null,
      tags: tags.value
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      glass: glass.value || null,
      method: method.value || null,
      color: color.value,
      ingredients: ings.filter((i) => i.name.trim()),
      steps: steps.map((s) =>
        Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)),
      ),
    };
    const res = await attempt(() => (r ? api.updateRecipe(r.id, body) : api.addRecipe(body)));
    if (res) {
      close();
      toast(d.form.saved(res.result.name));
    }
  });

  drawIngs();
  drawSteps();
  ingBox.addEventListener('input', () => drawStepsSoon());
  let pending = 0;
  function drawStepsSoon() {
    clearTimeout(pending);
    pending = window.setTimeout(() => {
      // Keep the ingredient dropdowns in the steps in sync, without stealing focus.
      if (!stepBox.contains(document.activeElement)) drawSteps();
    }, 400);
  }
  close = openDialog(r ? r.name : d.form.newRecipe, form, { xwide: true });
}
