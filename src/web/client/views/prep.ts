import { h } from '../lib/h.js';
import { t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import { api } from '../lib/api.js';
import { attempt, field, openDialog, toast } from '../lib/ui.js';

/** "Make simple syrup": inputs come out of stock, a fresh bottle goes in. */
export function openPrep(): void {
  const d = t().prep;
  let close = () => {};
  const list = state.preparations;
  const pick = h(
    'select',
    { 'aria-label': d.what },
    list.map((p) => h('option', { value: String(p.id) }, p.name)),
  );
  const amount = h('input', { type: 'number', min: 50, step: 50, 'aria-label': d.amount });
  const info = h('div', { class: 'prep-info' });
  const show = () => {
    const p = list.find((x) => String(x.id) === pick.value);
    if (!p) return;
    if (!amount.value) amount.value = String(p.output.ml);
    const scale = Number(amount.value) / p.output.ml || 1;
    info.replaceChildren(
      h(
        'ul',
        { class: 'ing-lines' },
        p.inputs.map((i) =>
          h(
            'li',
            { class: `line ${i.from_stock ? 'line-available' : 'line-missing'}` },
            h('span', { class: 'mark' }, i.from_stock ? '−' : ''),
            h('span', { class: 'amt' }, `${Math.round(i.amount * scale)} ${i.unit}`),
            h('span', { class: 'what' }, i.name),
            h('span', { class: 'src' }, i.from_stock ? d.fromStock : d.notFromStock),
          ),
        ),
      ),
      h('p', { class: 'muted' }, d.keeps(p.output.shelf_life_days ?? null)),
      ...(p.notes ? [h('p', { class: 'muted' }, p.notes)] : []),
    );
  };
  pick.addEventListener('change', () => {
    amount.value = '';
    show();
  });
  amount.addEventListener('input', show);
  const form = h(
    'form',
    { class: 'sheet-body' },
    h('div', { class: 'form-grid' }, field(d.what, pick), field(d.amount, amount)),
    info,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        { type: 'button', class: 'btn btn-quiet', onclick: () => close() },
        t().common.cancel,
      ),
      h('button', { type: 'submit', class: 'btn btn-primary' }, d.make),
    ),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await attempt(() =>
      api.makePreparation({
        template: Number(pick.value),
        output_ml: Number(amount.value) || undefined,
      }),
    );
    if (r) {
      close();
      toast(d.made(r.result.made_ml, r.result.template));
    }
  });
  close = openDialog(d.title, form);
  show();
}
