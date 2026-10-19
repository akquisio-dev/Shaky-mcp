import { h } from '../lib/h.js';
import { describe, label, t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import { api } from '../lib/api.js';
import { attempt, field } from '../lib/ui.js';

export function renderShopping(): HTMLElement {
  const d = t();
  const name = h('input', {
    name: 'name',
    required: true,
    placeholder: d.shopping.placeholder,
    'aria-label': d.shopping.placeholder,
    maxLength: 80,
  });
  const prio = h(
    'select',
    { name: 'priority', 'aria-label': 'priority' },
    ['high', 'normal', 'low'].map((p) =>
      h('option', { value: p, selected: p === 'normal' }, label(d.shopping.priority, p)),
    ),
  );
  const form = h(
    'form',
    { class: 'add-row' },
    name,
    prio,
    h('button', { class: 'btn btn-primary', type: 'submit' }, d.shopping.add),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await attempt(() => api.addShopping({ name: name.value, priority: prio.value })))
      form.reset();
  });
  const open = state.shopping.filter((s) => !s.done);
  const done = state.shopping.filter((s) => s.done).slice(0, 15);
  const row = (s: (typeof state.shopping)[number]) =>
    h(
      'li',
      {
        class: `shop-item${s.done ? ' is-done' : ''} prio-${s.priority}${state.flash.has(`shopping:${s.id}`) ? ' wobble' : ''}`,
      },
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: s.done,
          onchange: () => attempt(() => api.updateShopping(s.id, { done: !s.done })),
        }),
        h('span', { class: 'shop-name' }, s.name),
      ),
      s.quantity ? h('span', { class: 'muted' }, s.quantity) : null,
      s.reason ? h('span', { class: 'muted reason' }, s.reason) : null,
      !s.done && s.priority !== 'normal'
        ? h(
            'span',
            { class: `badge prio-badge-${s.priority}` },
            label(d.shopping.priority, s.priority),
          )
        : null,
      h(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          'aria-label': d.shopping.remove,
          onclick: () => attempt(() => api.deleteShopping(s.id)),
        },
        '×',
      ),
    );
  return h(
    'div',
    { class: 'view narrow' },
    h(
      'section',
      { class: 'paper' },
      form,
      open.length
        ? h('ul', { class: 'shop-list' }, open.map(row))
        : h('p', { class: 'empty-state' }, d.shopping.empty),
    ),
    done.length
      ? h(
          'section',
          { class: 'paper paper-faded' },
          h('h2', null, d.shopping.done),
          h('ul', { class: 'shop-list' }, done.map(row)),
        )
      : null,
  );
}

export function renderGear(): HTMLElement {
  const d = t();
  const types = state.meta?.equipment_types ?? [];
  const glassTypes = state.meta?.glass_types ?? [];

  const eqForm = h(
    'form',
    { class: 'mini-form' },
    field(d.gear.name, h('input', { name: 'name', required: true })),
    field(
      d.gear.type,
      h('input', { name: 'type', required: true, list: 'eq-types', autocomplete: 'off' }),
    ),
    field(d.gear.replaces, h('input', { name: 'substitutes_for', placeholder: 'shaker' })),
    h(
      'datalist',
      { id: 'eq-types' },
      types.map((x) => h('option', { value: x })),
    ),
    h('button', { class: 'btn btn-primary', type: 'submit' }, d.gear.addEquipment),
  );
  eqForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(eqForm);
    const subs = String(f.get('substitutes_for') ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (
      await attempt(() =>
        api.saveEquipment({ name: f.get('name'), type: f.get('type'), substitutes_for: subs }),
      )
    )
      eqForm.reset();
  });

  const glForm = h(
    'form',
    { class: 'mini-form' },
    field(d.gear.name, h('input', { name: 'name', required: true })),
    field(
      d.gear.type,
      h('input', { name: 'type', required: true, list: 'gl-types', autocomplete: 'off' }),
    ),
    field(d.gear.count, h('input', { name: 'count', type: 'number', min: 0, value: '2' })),
    h(
      'datalist',
      { id: 'gl-types' },
      glassTypes.map((x) => h('option', { value: x })),
    ),
    h('button', { class: 'btn btn-primary', type: 'submit' }, d.gear.addGlass),
  );
  glForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(glForm);
    if (
      await attempt(() =>
        api.saveGlass({
          name: f.get('name'),
          type: f.get('type'),
          count: Number(f.get('count') ?? 1),
        }),
      )
    )
      glForm.reset();
  });

  return h(
    'div',
    { class: 'view gear' },
    h(
      'section',
      { class: 'paper' },
      h('h2', null, d.gear.equipment),
      h(
        'ul',
        { class: 'gear-list' },
        state.equipment.map((e) =>
          h(
            'li',
            {
              class: `${e.available ? '' : 'is-off'}${state.flash.has(`equipment:${e.id}`) ? ' wobble' : ''}`,
            },
            h('span', { class: 'gear-name' }, e.name, h('small', null, e.type.replace(/_/g, ' '))),
            e.substitutes_for.length
              ? h('span', { class: 'tag' }, d.gear.substitutes(e.substitutes_for.join(', ')))
              : null,
            h(
              'label',
              { class: 'switch' },
              h('input', {
                type: 'checkbox',
                checked: e.available,
                onchange: () =>
                  attempt(() => api.saveEquipment({ id: e.id, available: !e.available })),
              }),
              h('span', null, e.available ? d.gear.available : d.gear.unavailable),
            ),
            h(
              'button',
              {
                class: 'icon-btn',
                type: 'button',
                'aria-label': d.gear.remove,
                onclick: () => attempt(() => api.deleteEquipment(e.id)),
              },
              '×',
            ),
          ),
        ),
      ),
      eqForm,
    ),
    h(
      'section',
      { class: 'paper' },
      h('h2', null, d.gear.glassware),
      h(
        'ul',
        { class: 'gear-list' },
        state.glassware.map((g) =>
          h(
            'li',
            { class: state.flash.has(`glass:${g.id}`) ? 'wobble' : '' },
            h('span', { class: 'gear-name' }, g.name, h('small', null, g.type.replace(/_/g, ' '))),
            h(
              'span',
              { class: 'stepper' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'icon-btn',
                  'aria-label': '-1',
                  onclick: () =>
                    attempt(() => api.saveGlass({ id: g.id, count: Math.max(0, g.count - 1) })),
                },
                '−',
              ),
              h('output', null, g.count),
              h(
                'button',
                {
                  type: 'button',
                  class: 'icon-btn',
                  'aria-label': '+1',
                  onclick: () => attempt(() => api.saveGlass({ id: g.id, count: g.count + 1 })),
                },
                '+',
              ),
            ),
            h(
              'button',
              {
                class: 'icon-btn',
                type: 'button',
                'aria-label': d.gear.remove,
                onclick: () => attempt(() => api.deleteGlass(g.id)),
              },
              '×',
            ),
          ),
        ),
      ),
      glForm,
    ),
  );
}

export function renderActivity(): HTMLElement {
  const d = t();
  const fmt = new Intl.DateTimeFormat(d.lang, { dateStyle: 'medium', timeStyle: 'short' });
  return h(
    'div',
    { class: 'view narrow' },
    h(
      'section',
      { class: 'paper' },
      state.activity.length
        ? h(
            'ol',
            { class: 'timeline' },
            state.activity.map((a) =>
              h(
                'li',
                { class: `act act-${a.source}` },
                h('span', { class: `who who-${a.source}` }, d.activity.who[a.source] ?? a.source),
                h('span', { class: 'what' }, describe(a, false)),
                h('time', { dateTime: a.at }, fmt.format(new Date(a.at))),
              ),
            ),
          )
        : h('p', { class: 'empty-state' }, d.activity.empty),
    ),
  );
}
