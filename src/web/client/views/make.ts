import { h } from '../lib/h.js';
import { label, t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import { api } from '../lib/api.js';
import { attempt, toast } from '../lib/ui.js';
import { formatAmount } from '../lib/units.js';

// "Mix for real": one big step at a time, for the kitchen counter.
// At the end the drink is logged and the stock deducted.

let recipeId: number | null = null;
let index = 0;
let servings = 1;
let rating = 0;
let timer: { left: number; total: number; handle: number } | null = null;
let wakeLock: { release(): Promise<void> } | null = null;

async function keepAwake(on: boolean) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await (
        navigator as unknown as {
          wakeLock: { request(t: string): Promise<{ release(): Promise<void> }> };
        }
      ).wakeLock.request('screen');
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    // Not available (e.g. tab in background); the view works without it.
  }
}

function stopTimer() {
  if (timer) clearInterval(timer.handle);
  timer = null;
}

export function renderMake(params: URLSearchParams, rerender: () => void): HTMLElement {
  const d = t();
  const id = Number(params.get('recipe'));
  if (id !== recipeId) {
    recipeId = id;
    index = 0;
    servings = 1;
    rating = 0;
    stopTimer();
  }
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return h('div', { class: 'view' }, h('p', { class: 'empty-state' }, d.recipe.none));
  void keepAwake(true);
  const total = r.steps.length;
  const done = index >= total;
  const scaled = (a?: number) =>
    a === undefined ? undefined : Math.round(a * servings * 100) / 100;

  const ingredients = h(
    'ul',
    { class: 'ing-lines make-ings' },
    r.availability.lines.map((l) =>
      h(
        'li',
        { class: `line line-${l.status}` },
        h(
          'label',
          { class: 'check' },
          h('input', { type: 'checkbox' }),
          h('span', { class: 'amt' }, formatAmount(scaled(l.amount), l.unit)),
        ),
        h('span', { class: 'what' }, l.name),
        h(
          'span',
          { class: 'src' },
          l.match ? `${l.match.name}, ${label(d.zones, l.match.location)}` : d.recipe.missing,
        ),
      ),
    ),
  );

  let stepCard: HTMLElement;
  if (!done) {
    const s = r.steps[index]!;
    const timerBox = s.duration_s
      ? h(
          'div',
          { class: 'make-timer' },
          timer
            ? h(
                'span',
                { class: 'countdown', role: 'timer', 'aria-live': 'polite' },
                `${timer.left} s`,
              )
            : h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-primary',
                  onclick: () => {
                    stopTimer();
                    timer = { left: s.duration_s!, total: s.duration_s!, handle: 0 };
                    timer.handle = window.setInterval(() => {
                      if (!timer) return;
                      timer.left -= 1;
                      if (timer.left <= 0) {
                        stopTimer();
                        navigator.vibrate?.(300);
                        toast(d.make.timeUp);
                      }
                      rerender();
                    }, 1000);
                    rerender();
                  },
                },
                d.make.startTimer(s.duration_s),
              ),
        )
      : null;
    stepCard = h(
      'section',
      { class: 'make-step paper' },
      h('p', { class: 'make-count' }, d.make.stepOf(index + 1, total)),
      h('h2', null, label(d.recipe.actions, s.action)),
      s.ingredient
        ? h('p', { class: 'make-what' }, formatAmount(scaled(s.amount), s.unit), ' ', s.ingredient)
        : null,
      s.equipment ? h('p', { class: 'muted' }, s.equipment.replace(/_/g, ' ')) : null,
      s.note ? h('p', { class: 'make-note' }, s.note) : null,
      timerBox,
    );
  } else {
    stepCard = h(
      'section',
      { class: 'make-step paper' },
      h('h2', null, d.make.done),
      h(
        'div',
        { class: 'rate', role: 'group', 'aria-label': d.make.rate },
        [1, 2, 3, 4, 5].map((n) =>
          h(
            'button',
            {
              type: 'button',
              class: `icon-btn star${n <= rating ? ' on' : ''}`,
              'aria-pressed': String(n <= rating),
              'aria-label': `${n}`,
              onclick: () => ((rating = n), rerender()),
            },
            n <= rating ? '★' : '☆',
          ),
        ),
      ),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary btn-big',
            onclick: async () => {
              const res = await attempt(() =>
                api.mix({ recipe: r.id, servings, deduct: true, ...(rating ? { rating } : {}) }),
              );
              if (res) {
                toast(d.recipe.mixedDone(r.name));
                void keepAwake(false);
                location.hash = '#/recipes';
              }
            },
          },
          d.make.finish,
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-quiet',
            onclick: async () => {
              if (
                await attempt(() =>
                  api.mix({ recipe: r.id, servings, deduct: false, ...(rating ? { rating } : {}) }),
                )
              ) {
                void keepAwake(false);
                location.hash = '#/recipes';
              }
            },
          },
          d.make.finishNoStock,
        ),
      ),
    );
  }

  return h(
    'div',
    { class: 'view make' },
    h(
      'div',
      { class: 'make-head' },
      h('h1', null, r.name),
      h(
        'label',
        { class: 'pref' },
        h('span', null, d.make.servings),
        h(
          'select',
          {
            onchange: (e: Event) => (
              (servings = Number((e.target as HTMLSelectElement).value)),
              rerender()
            ),
          },
          [1, 2, 3, 4, 6].map((n) =>
            h('option', { value: n, selected: n === servings }, String(n)),
          ),
        ),
      ),
      r.glass
        ? h('span', { class: 'muted' }, `${d.recipe.glass}: ${label(d.game.glasses, r.glass)}`)
        : null,
    ),
    h(
      'div',
      { class: 'make-grid' },
      h('section', { class: 'paper' }, h('h3', null, d.recipe.ingredients), ingredients),
      h(
        'div',
        { class: 'make-main' },
        h(
          'div',
          { class: 'dots', 'aria-hidden': 'true' },
          r.steps.map((_, i) => h('span', { class: i < index ? 'on' : i === index ? 'now' : '' })),
          h('span', { class: done ? 'now' : '' }),
        ),
        stepCard,
        h(
          'div',
          { class: 'actions make-nav' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              disabled: index === 0,
              onclick: () => (stopTimer(), (index -= 1), rerender()),
            },
            d.make.back,
          ),
          done
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-primary btn-big',
                  onclick: () => (stopTimer(), (index += 1), rerender()),
                },
                d.make.next,
              ),
        ),
      ),
    ),
  );
}

export function leaveMake(): void {
  stopTimer();
  void keepAwake(false);
}
