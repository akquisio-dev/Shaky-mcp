import {
  api,
  type Activity,
  type Equipment,
  type Glass,
  type IngredientView,
  type Meta,
  type MixLogEntry,
  type Preference,
  type TrashItem,
  type Substitution,
  type UndoGroup,
  type Template,
  type RecipeWithCheck,
  type ShoppingItem,
} from './api.js';

export interface State {
  meta?: Meta;
  ingredients: IngredientView[];
  equipment: Equipment[];
  glassware: Glass[];
  recipes: RecipeWithCheck[];
  shopping: ShoppingItem[];
  activity: Activity[];
  mixes: MixLogEntry[];
  preferences: Preference[];
  undoable: UndoGroup[];
  substitutions: Substitution[];
  trash: TrashItem[];
  preparations: Template[];
  /** Ids that changed through the live feed, for a short wobble. */
  flash: Set<string>;
}

type Slice =
  | 'meta'
  | 'ingredients'
  | 'equipment'
  | 'glassware'
  | 'recipes'
  | 'shopping'
  | 'activity'
  | 'mixes'
  | 'preferences'
  | 'undoable'
  | 'substitutions'
  | 'trash'
  | 'preparations';

export const state: State = {
  ingredients: [],
  equipment: [],
  glassware: [],
  recipes: [],
  shopping: [],
  activity: [],
  mixes: [],
  preferences: [],
  undoable: [],
  substitutions: [],
  trash: [],
  preparations: [],
  flash: new Set(),
};

const loaders: Record<Slice, () => Promise<void>> = {
  meta: async () => void (state.meta = await api.meta()),
  ingredients: async () => void (state.ingredients = await api.ingredients()),
  equipment: async () => void (state.equipment = await api.equipment()),
  glassware: async () => void (state.glassware = await api.glassware()),
  recipes: async () => void (state.recipes = await api.recipes()),
  shopping: async () => void (state.shopping = await api.shopping()),
  activity: async () => void (state.activity = await api.activity()),
  mixes: async () => void (state.mixes = await api.mixLog()),
  preferences: async () => void (state.preferences = await api.preferences()),
  undoable: async () => void (state.undoable = await api.undoable()),
  substitutions: async () => void (state.substitutions = await api.substitutions()),
  trash: async () => void (state.trash = await api.trash()),
  preparations: async () => void (state.preparations = await api.preparations()),
};

const listeners = new Set<() => void>();
export const onChange = (fn: () => void) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

export async function load(slices: Slice[]): Promise<void> {
  await Promise.all(slices.map((s) => loaders[s]()));
  notify();
}

export const loadAll = () => load(Object.keys(loaders) as Slice[]);

/** Which data an activity row invalidates. Recipes depend on stock and gear. */
export function slicesFor(entity: string): Slice[] {
  // Any change can be undone, and deletions land in the trash.
  return [...new Set([...slicesForEntity(entity), 'undoable', 'trash'] as Slice[])];
}

function slicesForEntity(entity: string): Slice[] {
  switch (entity) {
    case 'ingredient':
    case 'mix':
      return ['ingredients', 'recipes', 'activity', 'mixes'];
    case 'equipment':
      return ['equipment', 'recipes', 'activity'];
    case 'glass':
      return ['glassware', 'activity'];
    case 'recipe':
      return ['recipes', 'activity'];
    case 'substitution':
      return ['substitutions', 'recipes', 'activity'];
    case 'preference':
      return ['preferences', 'recipes', 'activity'];
    case 'prep':
      return ['preparations', 'ingredients', 'recipes', 'activity'];
    case 'shopping':
      return ['shopping', 'activity'];
    case 'undo':
      return Object.keys(loaders) as Slice[];
    case 'location':
    case 'category':
    case 'settings':
      return ['meta', 'ingredients', 'activity'];
    default:
      return Object.keys(loaders) as Slice[];
  }
}
