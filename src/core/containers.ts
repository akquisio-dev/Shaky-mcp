// Plain constants without zod, so the browser bundle can import them cheaply.

/** How an item is drawn. Count containers (can, fruit) show pieces instead of a fill level. */
export const CONTAINERS = [
  'bottle',
  'bottle_round',
  'bottle_flat',
  'bottle_square',
  'wine_bottle',
  'syrup_bottle',
  'dropper',
  'small_bottle',
  'can',
  'tetra_pak',
  'pet_bottle',
  'carton',
  'freezer_bag',
  'jar',
  'pack',
  'fruit',
  'herb',
] as const;
export type Container = (typeof CONTAINERS)[number];
