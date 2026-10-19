import { h } from '../lib/h.js';
import { describe, label, t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import { api } from '../lib/api.js';
import { attempt, field, toast } from '../lib/ui.js';

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
    field(
      d.gear.minMl,
      h('input', { name: 'min_ml', type: 'number', min: 0, placeholder: 'slush' }),
    ),
    field(
      d.gear.maxMl,
      h('input', { name: 'max_ml', type: 'number', min: 0, placeholder: 'slush' }),
    ),
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
        api.saveEquipment({
          name: f.get('name'),
          type: f.get('type'),
          substitutes_for: subs,
          ...(f.get('min_ml') || f.get('max_ml')
            ? {
                specs: {
                  ...(f.get('min_ml') && { min_ml: Number(f.get('min_ml')) }),
                  ...(f.get('max_ml') && { max_ml: Number(f.get('max_ml')) }),
                },
              }
            : {}),
        }),
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
            e.specs.min_ml || e.specs.max_ml
              ? h(
                  'span',
                  { class: 'tag' },
                  `${e.specs.min_ml ?? '?'} bis ${e.specs.max_ml ?? '?'} ml`,
                )
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
    renderHousehold(),
    renderPreferences(),
  );
}

/** Personal taste: amount tweaks and things to avoid. */
function renderPreferences(): HTMLElement {
  const d = t().prefs;
  const kind = h(
    'select',
    { 'aria-label': d.kind },
    h('option', { value: 'adjust' }, d.adjust),
    h('option', { value: 'avoid' }, d.avoid),
  );
  const ingredient = h('input', {
    required: true,
    placeholder: d.ingredientPh,
    'aria-label': d.ingredient,
  });
  const delta = h('input', {
    type: 'number',
    step: '0.25',
    placeholder: '-0.5',
    'aria-label': d.delta,
    class: 'num',
  });
  const scope = h('input', { placeholder: d.scopePh, 'aria-label': d.scope });
  const form = h(
    'form',
    { class: 'pref-form' },
    kind,
    ingredient,
    delta,
    h('span', { class: 'muted' }, 'cl'),
    scope,
    h('button', { class: 'btn btn-primary', type: 'submit' }, t().shopping.add),
  );
  kind.addEventListener('change', () => {
    delta.disabled = kind.value === 'avoid';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      kind: kind.value,
      ingredient: ingredient.value,
      ...(kind.value === 'adjust' && { delta: Number(delta.value.replace(',', '.')), unit: 'cl' }),
      ...(scope.value.trim() && { recipe_tag: scope.value.trim() }),
    };
    if (await attempt(() => api.addPreference(body))) form.reset();
  });
  return h(
    'section',
    { class: 'paper' },
    h('h2', null, d.title),
    h('p', { class: 'muted' }, d.hint),
    h(
      'ul',
      { class: 'gear-list' },
      state.preferences.map((p) =>
        h(
          'li',
          null,
          h(
            'span',
            { class: 'gear-name' },
            p.kind === 'avoid'
              ? d.avoidText(p.ingredient)
              : d.adjustText(
                  p.ingredient,
                  String(p.delta ?? p.factor ?? '').replace('.', t().lang === 'de' ? ',' : '.'),
                  p.unit ?? 'cl',
                ),
            p.recipe_tag || p.recipe
              ? h('small', null, d.only(p.recipe ?? p.recipe_tag ?? ''))
              : null,
          ),
          h(
            'button',
            {
              class: 'icon-btn',
              type: 'button',
              'aria-label': t().gear.remove,
              onclick: () => attempt(() => api.removePreference(p.id)),
            },
            '×',
          ),
        ),
      ),
    ),
    form,
  );
}

/** Household items that stand in for missing bar tools (a spoon for the bar spoon ...). */
function renderHousehold(): HTMLElement {
  const d = t();
  const current = (state.meta?.settings.household_substitutes ?? {}) as Record<string, string>;
  const save = (next: Record<string, string>) =>
    attempt(() => api.settings({ household_substitutes: next }));
  const type = h('input', {
    required: true,
    list: 'eq-types',
    placeholder: 'strainer',
    'aria-label': d.gear.type,
  });
  const name = h('input', {
    required: true,
    placeholder: d.gear.householdPh,
    'aria-label': d.gear.name,
  });
  const form = h(
    'form',
    { class: 'add-row add-row-2' },
    type,
    name,
    h('button', { class: 'btn btn-primary', type: 'submit' }, d.shopping.add),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (
      await save({
        ...current,
        [type.value.trim().toLowerCase().replace(/\s+/g, '_')]: name.value.trim(),
      })
    )
      form.reset();
  });
  return h(
    'section',
    { class: 'paper' },
    h('h2', null, d.gear.household),
    h('p', { class: 'muted' }, d.gear.householdHint),
    h(
      'ul',
      { class: 'gear-list' },
      Object.entries(current).map(([k, v]) =>
        h(
          'li',
          null,
          h(
            'span',
            { class: 'gear-name' },
            v,
            h('small', null, d.gear.replacesType(label(t().game.equipment, k))),
          ),
          h(
            'button',
            {
              class: 'icon-btn',
              type: 'button',
              'aria-label': d.gear.remove,
              onclick: () =>
                save(Object.fromEntries(Object.entries(current).filter(([x]) => x !== k))),
            },
            '×',
          ),
        ),
      ),
    ),
    form,
  );
}

export function renderActivity(): HTMLElement {
  exampleCount = null; // recount on every visit: imports and undos change it
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
    state.mixes.length
      ? h(
          'section',
          { class: 'paper' },
          h('h2', null, d.activity.mixes),
          h(
            'ol',
            { class: 'timeline' },
            state.mixes.map((m) =>
              h(
                'li',
                { class: 'act' },
                h('span', { class: 'who who-mcp' }, m.servings === 1 ? '1×' : `${m.servings}×`),
                h(
                  'span',
                  { class: 'what' },
                  m.name,
                  m.deducted.length
                    ? h(
                        'small',
                        { class: 'muted' },
                        ` (${m.deducted.map((x) => x.name).join(', ')})`,
                      )
                    : null,
                ),
                h('time', { dateTime: m.made_at }, fmt.format(new Date(m.made_at))),
              ),
            ),
          ),
        )
      : null,
    renderUndo(),
    renderTrash(),
    renderBackup(),
  );
}

function renderUndo(): HTMLElement | null {
  const d = t().undo;
  if (!state.undoable.length) return null;
  const fmt = new Intl.DateTimeFormat(t().lang, { timeStyle: 'short', dateStyle: 'short' });
  return h(
    'section',
    { class: 'paper' },
    h('h2', null, d.title),
    h(
      'ol',
      { class: 'timeline' },
      state.undoable.slice(0, 8).map((g) =>
        h(
          'li',
          { class: `act act-${g.source}` },
          h('span', { class: `who who-${g.source}` }, t().activity.who[g.source] ?? g.source),
          h(
            'span',
            { class: 'what' },
            g.first
              ? describe(
                  {
                    id: 0,
                    at: g.at,
                    entity_id: null,
                    summary: g.label ?? '',
                    ...g.first,
                    source: g.first.source as never,
                  },
                  false,
                )
              : (g.label ?? ''),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small btn-quiet',
              onclick: async () => {
                try {
                  await api.undo({ group: g.id });
                  toast(d.done);
                } catch (e) {
                  if (confirm(`${(e as Error).message}\n\n${d.forceConfirm}`)) {
                    if (await attempt(() => api.undo({ group: g.id, force: true }))) toast(d.done);
                  }
                }
              },
            },
            d.button,
          ),
          h('time', { dateTime: g.at }, fmt.format(new Date(g.at))),
        ),
      ),
    ),
  );
}

function renderTrash(): HTMLElement | null {
  const d = t().undo;
  if (!state.trash.length) return null;
  return h(
    'section',
    { class: 'paper' },
    h('h2', null, d.trash),
    h('p', { class: 'muted' }, d.trashHint),
    h(
      'ul',
      { class: 'gear-list' },
      state.trash.map((x) =>
        h(
          'li',
          null,
          h('span', { class: 'gear-name' }, x.name, h('small', null, label(d.kinds, x.kind))),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small',
              onclick: async () =>
                (await attempt(() => api.restore(x.id))) && toast(d.restored(x.name)),
            },
            d.restore,
          ),
        ),
      ),
    ),
  );
}

let exampleCount: number | null = null;

function examplesButton(): HTMLElement | null {
  const d = t();
  if (exampleCount === null) {
    void api.examples().then((r) => {
      exampleCount = r.count;
      if (r.count) document.querySelector('.examples-slot')?.replaceWith(examplesButton() ?? '');
    });
    return h('span', { class: 'examples-slot' });
  }
  if (!exampleCount) return null;
  return h(
    'button',
    {
      type: 'button',
      class: 'btn btn-quiet',
      onclick: async () => {
        if (!confirm(d.backup.removeExamplesConfirm(exampleCount ?? 0))) return;
        const r = await attempt(() => api.removeExamples());
        if (r) {
          exampleCount = 0;
          toast(d.backup.examplesRemoved(r.result.total));
        }
      },
    },
    d.backup.removeExamples(exampleCount),
  );
}

function renderBackup(): HTMLElement {
  const d = t();
  const file = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    'aria-label': d.backup.file,
  });
  const mode = h(
    'select',
    { 'aria-label': d.backup.mode },
    h('option', { value: 'merge' }, d.backup.merge),
    h('option', { value: 'replace' }, d.backup.replace),
  );
  const run = async () => {
    const f = file.files?.[0];
    if (!f) return;
    let data: unknown;
    try {
      data = JSON.parse(await f.text());
    } catch {
      toast(d.backup.badFile, 'error');
      return;
    }
    if (mode.value === 'replace' && !confirm(d.backup.confirmReplace)) return;
    const r = await attempt(() => api.importBar(data, mode.value as 'merge' | 'replace'));
    if (r) {
      toast(d.backup.imported);
      file.value = '';
    }
  };
  return h(
    'section',
    { class: 'paper' },
    h('h2', null, d.backup.title),
    h('p', { class: 'muted' }, d.backup.hint),
    h(
      'div',
      { class: 'actions' },
      h('a', { class: 'btn', href: '/api/export', download: '' }, d.backup.export),
      examplesButton(),
    ),
    h(
      'div',
      { class: 'actions' },
      file,
      mode,
      h('button', { class: 'btn btn-primary', type: 'button', onclick: run }, d.backup.import),
    ),
  );
}
