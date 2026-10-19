import { h } from '../lib/h.js';
import { t } from '../lib/i18n.js';
import { api, type Activity } from '../lib/api.js';
import { attempt, openDialog, toast } from '../lib/ui.js';
import {
  activeTraining,
  endTraining,
  setTrainingSubmit,
  showScore,
  startTraining,
} from './scene.js';

// Trainings started by the AI (or anyone) reach the browser through the
// activity feed. This module offers them, runs them in the scene and hands
// the action log back to the server, which scores it.

const offered = new Set<number>();

export async function checkTrainings(): Promise<void> {
  const open = await api.trainings(true).catch(() => []);
  const t0 = open[0];
  if (!t0 || offered.has(t0.id) || activeTraining()?.id === t0.id) return;
  offered.add(t0.id);
  const d = t().training;
  let close = () => {};
  const begin = async () => {
    const r = await attempt(() => api.startTraining(t0.id));
    if (!r) return;
    close();
    startTraining({
      id: t0.id,
      recipe_id: t0.recipe_id!,
      note: t0.note,
      show_steps: t0.show_steps,
      sandbox: t0.sandbox,
    });
    location.hash = '#/mix';
  };
  close = openDialog(
    d.offerTitle,
    h(
      'div',
      { class: 'sheet-body offer' },
      h('p', { class: 'offer-recipe' }, t0.recipe_name),
      t0.note ? h('p', { class: 'bubble' }, t0.note) : null,
      h('p', { class: 'muted' }, t0.show_steps ? d.withSteps : d.fromMemory),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close() }, d.later),
        h('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: begin }, d.go),
      ),
    ),
  );
}

/** Reacts to training rows in the live feed. */
export function onTrainingActivity(a: Activity): void {
  const current = activeTraining();
  if (a.action === 'created') void checkTrainings();
  if (a.action === 'cancelled' && current && current.id === a.entity_id) {
    endTraining();
    toast(t().training.cancelled);
  }
}

setTrainingSubmit(async (actions, recipe) => {
  const current = activeTraining();
  if (!current) return;
  const r = await attempt(() => api.submitTraining(current.id, actions));
  if (!r?.result.result) return;
  endTraining();
  showScore(r.result.result, recipe.name, h('p', { class: 'muted' }, t().training.sent));
});
