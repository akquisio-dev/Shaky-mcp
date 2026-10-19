import { h } from '../lib/h.js';
import { t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import { api, type RecipeWithCheck } from '../lib/api.js';
import { attempt, field, openDialog } from '../lib/ui.js';
import { formatAmount } from '../lib/units.js';

/** Scale a recipe to N glasses, for parties or the slush machine. */
export function openBatch(r: RecipeWithCheck): void {
  const d = t().batch;
  const machines = state.equipment.filter((e) => e.type === 'slush_machine');
  const glasses = h('input', { type: 'number', min: 1, max: 500, value: '8' });
  const serving = h('input', { type: 'number', min: 20, max: 2000, placeholder: d.servingPh });
  const machine = h(
    'select',
    null,
    h('option', { value: '' }, d.noMachine),
    machines.map((m, i) =>
      h(
        'option',
        { value: String(m.id), selected: i === 0 },
        `${m.name}${m.specs.min_ml ? ` (${m.specs.min_ml} bis ${m.specs.max_ml ?? '?'} ml)` : ''}`,
      ),
    ),
  );
  const out = h('div', { class: 'batch-out' });
  const run = async () => {
    const res = await attempt(() =>
      api.batch({
        recipe: r.id,
        glasses: Number(glasses.value) || undefined,
        serving_ml: Number(serving.value) || undefined,
        machine: machine.value ? Number(machine.value) : undefined,
      }),
    );
    if (!res) return;
    out.replaceChildren(
      h(
        'p',
        { class: 'strength' },
        d.summary(
          res.total_ml,
          res.glasses,
          String(res.abv).replace('.', t().lang === 'de' ? ',' : '.'),
        ),
      ),
      h(
        'ul',
        { class: 'ing-lines' },
        res.amounts.map((a) =>
          h(
            'li',
            { class: 'line line-available' },
            h('span', { class: 'mark' }, ''),
            h(
              'span',
              { class: 'amt' },
              'ml' in a ? formatAmount(a.cl, 'cl') : formatAmount(a.amount ?? undefined, a.unit),
            ),
            h('span', { class: 'what' }, a.name),
          ),
        ),
      ),
      ...warningList(res.flags),
    );
  };
  [glasses, serving, machine].forEach((el) => el.addEventListener('change', run));
  openDialog(
    d.title(r.name),
    h(
      'div',
      { class: 'sheet-body' },
      h(
        'div',
        { class: 'form-grid' },
        field(d.glasses, glasses),
        field(d.serving, serving),
        h('label', { class: 'field span-2' }, h('span', null, d.machine), machine),
      ),
      out,
    ),
  );
  void run();
}

function warningList(f: {
  min_glasses?: number;
  min_ml?: number;
  max_glasses?: number;
  max_ml?: number;
  too_strong?: { max_abv: number; top_up_ml: number | null };
  energy?: boolean;
}): HTMLElement[] {
  const d = t().batch;
  const items = [
    f.min_glasses ? d.belowMin(f.min_ml ?? 0, f.min_glasses) : null,
    f.max_glasses !== undefined ? d.aboveMax(f.max_ml ?? 0, f.max_glasses) : null,
    f.too_strong ? d.tooStrong(f.too_strong.max_abv, f.too_strong.top_up_ml ?? 0) : null,
    f.energy ? t().recipe.energy : null,
  ].filter((x): x is string => Boolean(x));
  return items.length
    ? [
        h(
          'ul',
          { class: 'warnings' },
          items.map((w) => h('li', null, w)),
        ),
      ]
    : [];
}
