import { de } from '../i18n/de.js';
import { en, type Dict } from '../i18n/en.js';
import type { Activity } from './api.js';

const DICTS: Record<string, Dict> = { en, de };
let current: Dict = en;

export function setLanguage(pref: string | undefined): void {
  const lang =
    pref && pref !== 'auto'
      ? pref
      : (navigator.languages?.[0] ?? navigator.language ?? 'en').slice(0, 2);
  current = DICTS[lang] ?? en;
  document.documentElement.lang = current.lang;
}

export const t = (): Dict => current;

export const label = (map: Record<string, string>, key: string) =>
  map[key] ?? key.replace(/_/g, ' ');

/** Human sentence for one activity row, in the UI language. */
export function describe(a: Activity, withWho = true): string {
  const d = current;
  const who = withWho ? (d.activity.who[a.source] ?? a.source) : '';
  return sentence(a, who).trim();
}

function sentence(a: Activity, who: string): string {
  const d = current;
  const name = String(a.data.name ?? '');
  const changes = (a.data.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
  const de = d.lang === 'de';
  if (
    a.entity === 'ingredient' &&
    a.action === 'updated' &&
    changes.fill_level &&
    Object.keys(changes).length <= 3
  ) {
    const lvl = label(d.fill, String(changes.fill_level.to));
    return de ? `${who} hat ${name} auf ‚${lvl}‘ gesetzt` : `${who} set ${name} to ${lvl}`;
  }
  if (a.entity === 'ingredient' && changes.opened_at?.to) {
    return de ? `${who} hat ${name} geöffnet` : `${who} opened ${name}`;
  }
  if (a.entity === 'bar') {
    const n = a.data as Record<string, number>;
    const what = de
      ? `${n.ingredients ?? 0} Zutaten, ${n.recipes ?? 0} Rezepte, ${n.equipment ?? 0} Werkzeuge, ${n.glassware ?? 0} Gläser`
      : `${n.ingredients ?? 0} ingredients, ${n.recipes ?? 0} recipes, ${n.equipment ?? 0} tools, ${n.glassware ?? 0} glasses`;
    if (a.action === 'examples_removed')
      return de ? `${who} hat die Beispieldaten entfernt` : `${who} removed the example data`;
    if (a.action === 'reset')
      return de ? `${who} hat die Bar ersetzt: ${what}` : `${who} replaced the bar: ${what}`;
    return de ? `${who} hat Daten geladen: ${what}` : `${who} loaded data: ${what}`;
  }
  if (a.entity === 'training') {
    const score = a.data.score as number | undefined;
    if (a.action === 'created')
      return de
        ? `${who} hat eine Übung vorbereitet: ${name}`
        : `${who} set up a training: ${name}`;
    if (a.action === 'finished')
      return de
        ? `${who} hat ${name} geübt: ${score}/100`
        : `${who} practiced ${name}: ${score}/100`;
    if (a.action === 'started')
      return de ? `${who} hat die Übung ${name} begonnen` : `${who} started the ${name} training`;
    return de ? `${who} hat die Übung ${name} beendet` : `${who} ended the ${name} training`;
  }
  if (a.entity === 'preference') {
    return a.action === 'deleted'
      ? de
        ? `${who} hat eine Vorliebe gelöscht: ${name}`
        : `${who} removed a preference: ${name}`
      : de
        ? `${who} hat sich eine Vorliebe gemerkt: ${name}`
        : `${who} saved a preference: ${name}`;
  }
  if (a.entity === 'prep' && a.action === 'made') {
    return de
      ? `${who} hat ${a.data.ml} ml ${name} angesetzt`
      : `${who} made ${a.data.ml} ml ${name}`;
  }
  if (a.entity === 'undo') {
    const of = a.data.of as {
      entity: string;
      action: string;
      data: Record<string, unknown>;
      source: string;
    } | null;
    const original = of
      ? ({ ...a, ...of, entity_id: null, summary: name } as unknown as Activity)
      : null;
    const what = original
      ? sentence(original, d.activity.who[original.source] ?? original.source).trim()
      : name;
    return de ? `${who} hat rückgängig gemacht: ${what}` : `${who} undid: ${what}`;
  }
  if (a.entity === 'ui') {
    return de
      ? `${who} zeigt dir ${name || 'etwas'}`
      : `${who} is showing you ${name || 'something'}`;
  }
  if (a.entity === 'mix' && a.action === 'rated') {
    return de ? `${who} hat ${name} bewertet` : `${who} rated ${name}`;
  }
  if (a.entity === 'shopping' && a.action === 'done') {
    return de ? `${who} hat ${name} gekauft` : `${who} bought ${name}`;
  }
  if (a.action === 'restocked') {
    return de ? `${who} hat ${name} aufgefüllt` : `${who} restocked ${name}`;
  }
  if (a.entity === 'settings') {
    return de
      ? `${who} hat die Einstellung ${String(a.data.key)} geändert`
      : `${who} changed the ${String(a.data.key)} setting`;
  }
  const verbs: Record<string, [string, string]> = {
    created: ['added', 'hinzugefügt'],
    updated: ['changed', 'geändert'],
    archived: ['archived', 'archiviert'],
    restored: ['restored', 'wiederhergestellt'],
    deleted: ['removed', 'entfernt'],
    used: ['used some', 'verwendet'],
    mixed: ['mixed', 'gemixt'],
    done: ['bought', 'gekauft'],
  };
  const v = verbs[a.action];
  if (!v || !name) return who ? `${who}: ${a.summary}` : a.summary;
  if (a.action === 'used')
    return de ? `${who} hat etwas ${name} verwendet` : `${who} used some ${name}`;
  return de ? `${who} hat ${name} ${v[1]}` : `${who} ${v[0]} ${name}`;
}
