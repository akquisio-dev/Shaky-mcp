import { h, svg } from '../lib/h.js';
import { label, t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import type { IngredientView } from '../lib/api.js';
import { ingredientSvg } from '../svg/art.js';
import { daysSince } from '../lib/ui.js';
import { openIngredient, openIngredientForm } from './ingredient.js';
import { openPrep } from './prep.js';
import { startWaiting, waitingTraining } from '../game/training.js';

export function badges(i: IngredientView): HTMLElement[] {
  const d = t().badge;
  const out: HTMLElement[] = [];
  if (i.fill_level === 'empty' || i.quantity <= 0) {
    // Empty is the only thing worth saying about an empty bottle.
    out.push(h('span', { class: 'badge b-empty' }, d.empty));
    return out;
  }
  if (i.low) out.push(h('span', { class: 'badge b-low' }, d.low));
  if (i.display_container === 'can' && i.opened_at)
    out.push(h('span', { class: 'badge b-open' }, d.canOpen));
  if (i.expired) out.push(h('span', { class: 'badge b-expired' }, d.expired));
  else if (i.expiring_soon && i.days_left !== null)
    out.push(h('span', { class: 'badge b-soon' }, d.useIn(i.days_left)));
  else if (i.opened_at && i.days_left !== null && i.display_container !== 'can')
    out.push(h('span', { class: 'badge b-open' }, d.openedDays(daysSince(i.opened_at))));
  return out;
}

function bottle(i: IngredientView): HTMLElement {
  const fillName = label(t().fill, i.fill_level);
  const out = i.fill_level === 'empty' || i.quantity <= 0;
  return h(
    'button',
    {
      class: `bottle-card${out ? ' is-out' : ''}${i.expired ? ' is-expired' : ''}${state.flash.has(`ingredient:${i.id}`) ? ' wobble' : ''}`,
      type: 'button',
      onclick: () => openIngredient(i.id),
      title: `${i.name}, ${fillName}`,
    },
    h(
      'span',
      { class: 'bottle-art' },
      svg(ingredientSvg(i)),
      i.quantity > 1 && !i.counted
        ? h('span', { class: 'count' }, t().badge.count(i.quantity))
        : null,
    ),
    h('span', { class: 'bottle-name' }, i.name),
    // Cans and fruit are counted: a fill level makes no sense there.
    i.counted || i.display_container === 'herb'
      ? h('span', { class: 'bottle-sub' }, t().badge.count(i.quantity))
      : h(
          'span',
          {
            class: 'gauge',
            role: 'meter',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': Math.round(i.fill_fraction * 100),
            'aria-label': fillName,
          },
          h('span', { style: { width: `${Math.round(i.fill_fraction * 100)}%` } }),
        ),
    h('span', { class: 'badges' }, badges(i)),
  );
}

export function renderBar(): HTMLElement {
  const d = t();
  const items = state.ingredients.filter((i) => !i.archived);
  const locs = state.meta?.locations ?? [];
  const known = new Set(locs.map((l) => l.key));
  const zones = [
    ...locs.map((l) => l.key),
    ...new Set(items.map((i) => i.location).filter((k) => !known.has(k))),
  ];
  const makeable = state.recipes.filter((r) => r.availability.status === 'makeable');
  const warnings = items.filter((i) => i.expired || i.expiring_soon || i.low);

  const head = h(
    'section',
    { class: 'bar-head' },
    h(
      'div',
      { class: 'bar-summary' },
      waitingTraining
        ? h(
            'div',
            { class: 'training-banner waiting' },
            h('strong', null, d.training.waiting(waitingTraining.recipe_name)),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small btn-primary',
                onclick: () => void startWaiting(),
              },
              d.training.go,
            ),
          )
        : null,
      makeable.length
        ? h(
            'a',
            { href: '#/recipes?status=makeable', class: 'sticker sticker-lagoon' },
            d.bar.makeable(makeable.length),
          )
        : null,
      warnings.length
        ? h(
            'div',
            { class: 'warn-row' },
            h('strong', null, `${d.bar.warnings}:`),
            warnings.map((i) =>
              h(
                'button',
                { class: 'chip chip-warn', type: 'button', onclick: () => openIngredient(i.id) },
                i.name,
                ' ',
                badges(i),
              ),
            ),
          )
        : null,
    ),
    h(
      'div',
      { class: 'bar-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => openPrep() }, d.prep.open),
      h(
        'button',
        { class: 'btn btn-primary', type: 'button', onclick: () => openIngredientForm() },
        `+ ${d.bar.add}`,
      ),
    ),
  );

  if (items.length === 0) {
    return h(
      'div',
      { class: 'view' },
      head,
      h(
        'div',
        { class: 'empty-state' },
        h('h2', null, d.bar.welcome),
        h('p', null, d.bar.welcomeHint),
      ),
    );
  }

  const scene = h(
    'div',
    { class: 'scene' },
    zones.map((key) => {
      const loc = locs.find((l) => l.key === key);
      const name = loc ? (d.lang === 'de' ? loc.label_de : loc.label_en) : label(d.zones, key);
      const inZone = items
        .filter((i) => i.location === key)
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      if (inZone.length === 0 && !['shelf', 'fridge', 'freezer', 'pantry'].includes(key))
        return null;
      return h(
        'section',
        {
          class: `zone zone-${loc?.game_zone ?? 'custom'}`,
          'aria-label': name,
          dataset: { zone: key },
        },
        h('h2', { class: 'zone-title' }, name),
        h(
          'div',
          { class: 'zone-body' },
          inZone.length ? inZone.map(bottle) : h('p', { class: 'zone-empty' }, d.bar.emptyZone),
        ),
      );
    }),
  );
  const archived = state.ingredients.filter((i) => i.archived);
  return h(
    'div',
    { class: 'view' },
    head,
    scene,
    archived.length
      ? h(
          'details',
          { class: 'archive' },
          h('summary', null, d.bar.archived(archived.length)),
          h(
            'div',
            { class: 'chips' },
            archived.map((i) =>
              h(
                'button',
                { class: 'chip', type: 'button', onclick: () => openIngredient(i.id) },
                i.name,
              ),
            ),
          ),
        )
      : null,
  );
}
