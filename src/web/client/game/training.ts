import { h } from '../lib/h.js';
import { t } from '../lib/i18n.js';
import { api, type Activity, type Training } from '../lib/api.js';
import { attempt, openDialog, toast } from '../lib/ui.js';
import {
  activeTraining,
  endTraining,
  setTrainingSubmit,
  setWaitingTraining,
  showScore,
  startTraining,
} from './scene.js';

// Trainings started by the AI (or anyone) reach the browser through the
// activity feed. This module offers them, runs them in the scene and hands
// the action log back to the server, which scores it.

const offered = new Set<number>();

/** Open trainings that are waiting, for chips on the bar and mix pages. */
export let waitingTraining: Training | null = null;

async function begin(tr: Training): Promise<boolean> {
  const r = await attempt(() => api.startTraining(tr.id));
  if (!r) return false;
  waitingTraining = null;
  setWaitingTraining(null);
  startTraining({
    id: tr.id,
    recipe_id: tr.recipe_id!,
    note: tr.note,
    show_steps: tr.show_steps,
    sandbox: tr.sandbox,
  });
  location.hash = '#/mix';
  return true;
}

export const startWaiting = () =>
  waitingTraining ? begin(waitingTraining) : Promise.resolve(false);

/** Looks for an open training; offers a new one once, keeps a chip for later. */
export async function checkTrainings(): Promise<void> {
  const open = await api.trainings(true).catch(() => []);
  const t0 = open[0];
  if (!t0 || activeTraining()?.id === t0.id) {
    waitingTraining = null;
    setWaitingTraining(null);
    return;
  }
  waitingTraining = t0;
  setWaitingTraining({ name: t0.recipe_name, start: () => void begin(t0) });
  if (offered.has(t0.id)) return;
  offered.add(t0.id);
  const d = t().training;
  let close = () => {};
  close = openDialog(
    d.offerTitle,
    h(
      'div',
      { class: 'sheet-body offer' },
      h('p', { class: 'offer-recipe' }, t0.recipe_name),
      t0.note ? h('p', { class: 'bubble' }, t0.note) : null,
      h('p', { class: 'muted' }, t0.show_steps ? d.withSteps : d.fromMemory),
      t0.sandbox ? h('p', { class: 'muted' }, d.sandboxOn) : null,
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close() }, d.later),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary btn-big',
            onclick: async () => (await begin(t0)) && close(),
          },
          d.go,
        ),
      ),
    ),
  );
}

/** Reacts to training rows in the live feed. */
export function onTrainingActivity(a: Activity): void {
  const current = activeTraining();
  if (a.action === 'cancelled' && current && current.id === a.entity_id) {
    endTraining();
    toast(t().training.cancelled);
  }
  void checkTrainings();
}

setTrainingSubmit(async (actions, recipe) => {
  const current = activeTraining();
  if (!current) return;
  const r = await attempt(() => api.submitTraining(current.id, actions));
  if (!r?.result.result) return;
  endTraining();
  showScore(r.result.result, recipe.name, h('p', { class: 'muted' }, t().training.sent));
});
