// All artwork is drawn here from scratch: simple shapes, thick ink outlines,
// liquid in the ingredient's own color. The container (bottle, can, carton ...)
// is separate from the liquid, so a purple can may hold a clear drink. The
// same shapes are the draggable items of the mixing game.

const INK = 'var(--ink)';

interface Shape {
  /** Outline path of the container. */
  body: string;
  /** Inner area that holds liquid: [top, bottom] in viewBox units. */
  liquid: [number, number];
  /** Optional cap / label decoration drawn on top. */
  extra?: (label: string) => string;
}

const label = (x: number, y: number, w: number, h: number, fill: string, r = 3) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${INK}" stroke-width="2" class="label"/>`;
const cap = (x: number, y: number, w: number, h: number, r = 2) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" class="cap"/>`;

// viewBox 0 0 60 120, every container stands on y=116.
const SHAPES: Record<string, Shape> = {
  bottle: {
    body: 'M24 4h12v22c0 4 12 8 12 20v66a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V46c0-12 12-16 12-20z',
    liquid: [46, 114],
    extra: (l) => cap(22, 2, 16, 8) + label(16, 62, 28, 26, l),
  },
  bottle_round: {
    body: 'M25 6h10v20c10 4 18 14 18 30v54a6 6 0 0 1-6 6H13a6 6 0 0 1-6-6V56c0-16 8-26 18-30z',
    liquid: [40, 114],
    extra: (l) =>
      cap(23, 2, 14, 9, 3) +
      `<circle cx="30" cy="78" r="13" fill="${l}" stroke="${INK}" stroke-width="2" class="label"/>`,
  },
  bottle_flat: {
    body: 'M25 18h10v14h10a6 6 0 0 1 6 6v72a6 6 0 0 1-6 6H15a6 6 0 0 1-6-6V38a6 6 0 0 1 6-6h10z',
    liquid: [40, 114],
    extra: (l) => cap(23, 12, 14, 9) + label(13, 58, 34, 34, l, 4),
  },
  bottle_square: {
    body: 'M25 4h10v20h12a4 4 0 0 1 4 4v84a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4V28a4 4 0 0 1 4-4h12z',
    liquid: [30, 114],
    extra: (l) => cap(23, 2, 14, 8) + label(13, 52, 34, 40, l, 1),
  },
  wine_bottle: {
    body: 'M26 4h8v30c0 6 14 10 14 24v54a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V58c0-14 14-18 14-24z',
    liquid: [52, 114],
    extra: (l) => cap(25, 2, 10, 14) + label(16, 72, 28, 22, l, 2),
  },
  syrup_bottle: {
    body: 'M26 16h8v18c0 4 8 6 8 14v64a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V48c0-8 8-10 8-14z',
    liquid: [42, 114],
    extra: (l) =>
      // a metal pourer with its little spout
      `<path d="M27 16l1-6h4l1 6z" fill="#c9ced6" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M31 10l7-8" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
      label(20, 60, 20, 40, l),
  },
  dropper: {
    body: 'M26 40h8v10c6 2 12 6 12 14v48a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V64c0-8 6-12 12-14z',
    liquid: [60, 114],
    // the oversized paper label that sticks out on both sides
    extra: (l) =>
      cap(24, 30, 12, 12, 3) +
      `<path d="M28 30v-8a2 2 0 0 1 4 0v8" fill="${INK}"/>` +
      label(8, 66, 44, 40, l, 2),
  },
  small_bottle: {
    body: 'M27 24h6v8c0 4 9 6 9 14v66a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V46c0-8 9-10 9-14z',
    liquid: [44, 114],
    extra: (l) => cap(25, 20, 10, 7) + label(18, 70, 24, 18, l, 1),
  },
  pet_bottle: {
    body: 'M26 14h8v8c0 4 12 8 12 16v6c-3 2-3 5 0 7v51a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8V51c3-2 3-5 0-7v-6c0-8 12-12 12-16z',
    liquid: [36, 114],
    extra: (l) => cap(24, 8, 12, 8, 2) + label(14, 66, 32, 18, l, 0),
  },
  jar: {
    body: 'M12 36h36v74a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6z',
    liquid: [40, 114],
    extra: (l) =>
      `<rect x="10" y="26" width="40" height="12" rx="3" fill="${l}" stroke="${INK}" stroke-width="2.5"/>`,
  },
  freezer_bag: {
    body: 'M8 30h44v78a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8z',
    liquid: [40, 114],
    extra: (l) =>
      `<path d="M8 38h44" stroke="${l}" stroke-width="4"/><path d="M8 34h44" stroke="${INK}" stroke-width="2"/>`,
  },
};

/** Containers you cannot see into: drawn in their label color, content level on the gauge. */
const OPAQUE: Record<
  string,
  (fill: string, accent: string, opened: boolean, size: number | null) => string
> = {
  can: (fill, accent, opened, size) => {
    const tall = size !== null && size >= 450;
    const slim = size !== null && size <= 260;
    const x = slim ? 18 : 13;
    const w = slim ? 24 : 34;
    const top = tall ? 26 : slim ? 36 : 46;
    const h = 116 - top;
    const tab = opened
      ? `<ellipse cx="30" cy="${top + 1}" rx="4" ry="2" fill="${INK}"/><path d="M30 ${top}l7-7" stroke="#c9ced6" stroke-width="3" stroke-linecap="round"/>`
      : `<rect x="26" y="${top - 2}" width="8" height="3" rx="1.5" fill="#c9ced6" stroke="${INK}" stroke-width="1"/>`;
    return `
      <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="5" fill="${fill}" stroke="${INK}" stroke-width="3"/>
      <rect x="${x + 2}" y="${top + 2}" width="${w - 4}" height="5" rx="2" fill="#dfe3ea" stroke="${INK}" stroke-width="1.5"/>
      <rect x="${x + 2}" y="${116 - 7}" width="${w - 4}" height="5" rx="2" fill="#dfe3ea" stroke="${INK}" stroke-width="1.5"/>
      <path d="M${x + 4} ${top + 16}v${h - 30}" stroke="rgba(255,255,255,.5)" stroke-width="4" stroke-linecap="round"/>
      <rect x="${x + w / 2 - 6}" y="${top + h / 2 - 8}" width="12" height="16" rx="3" fill="${accent}" stroke="${INK}" stroke-width="1.5"/>
      ${tab}`;
  },
  tetra_pak: (fill, accent) => `
      <path d="M12 30l8-14h20l8 14v82a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z" fill="${fill}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M12 30h36" stroke="${INK}" stroke-width="2.5"/>
      <rect x="33" y="8" width="8" height="10" rx="2" class="cap"/>
      <circle cx="30" cy="72" r="11" fill="${accent}" stroke="${INK}" stroke-width="2"/>
      <path d="M16 96h28" stroke="rgba(255,255,255,.6)" stroke-width="3" stroke-linecap="round"/>`,
  carton: (fill, accent) => `
      <path d="M14 34l6-16h20l6 16v78a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z" fill="${fill}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M14 34h32" stroke="${INK}" stroke-width="2.5"/>
      <circle cx="30" cy="76" r="9" fill="${accent}" stroke="${INK}" stroke-width="2"/>`,
  pack: (fill, accent) => `
      <path d="M10 32l6-8h28l6 8v80a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z" fill="${fill}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M10 32h40M16 24l6 8M44 24l-6 8" stroke="${INK}" stroke-width="2"/>
      <rect x="16" y="58" width="28" height="30" rx="3" fill="${accent}" stroke="${INK}" stroke-width="2"/>`,
};

function fruitIcon(x: number, y: number, r: number, color: string, kind: string): string {
  if (kind === 'lemon') {
    return `<g><ellipse cx="${x}" cy="${y}" rx="${r * 1.15}" ry="${r * 0.85}" fill="${color}" stroke="${INK}" stroke-width="2.5"/>
      <path d="M${x - r * 1.15} ${y}l-3 0M${x + r * 1.15} ${y}l3 0" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M${x - r * 0.4} ${y - r * 0.35}q${r * 0.4} -${r * 0.3} ${r * 0.8} 0" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2" stroke-linecap="round"/></g>`;
  }
  if (kind === 'berry') {
    return `<g><circle cx="${x}" cy="${y}" r="${r * 0.7}" fill="${color}" stroke="${INK}" stroke-width="2"/><circle cx="${x - 1}" cy="${y - 1}" r="1.2" fill="rgba(255,255,255,.7)"/></g>`;
  }
  return `<g><circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="${INK}" stroke-width="2.5"/>
    <path d="M${x - r * 0.45} ${y - r * 0.3}q${r * 0.45} -${r * 0.4} ${r * 0.9} 0" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2" stroke-linecap="round"/>
    <path d="M${x} ${y - r}q2 -5 6 -6" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/></g>`;
}

/** Counted fruit: one icon per piece (up to nine), so one lemon looks like one lemon. */
function fruitPieces(color: string, count: number, hint: string, name: string): string {
  const h = hint.toLowerCase();
  const kind = /lemon|zitron/.test(h)
    ? 'lemon'
    : /berr|beere|cherr|kirsch/.test(h)
      ? 'berry'
      : 'round';
  const n = Math.max(1, Math.min(9, Math.ceil(count)));
  const r = n === 1 ? 14 : n <= 4 ? 11 : 8;
  const perRow = n === 1 ? 1 : n <= 4 ? 2 : 3;
  const step = r * 2 + 4;
  const rows = Math.ceil(n / perRow);
  let out = '';
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / perRow);
    const col = k % perRow;
    const inRow = Math.min(perRow, n - row * perRow);
    const x = 30 + (col - (inRow - 1) / 2) * step;
    const y = 116 - r - 2 - (rows - 1 - row) * (step - 2);
    out += fruitIcon(x, y, r, color, kind);
  }
  return `<svg viewBox="0 0 60 120" class="bottle fruit" role="img" aria-label="${name}">${out}</svg>`;
}

function herb(color: string, name: string): string {
  return `<svg viewBox="0 0 60 120" class="bottle fruit" role="img" aria-label="${name}">
    <path d="M30 116V64" stroke="${INK}" stroke-width="3" fill="none"/>
    <path d="M30 96c-20 0-24-20-18-30 12 0 20 10 18 30z" fill="${color}" stroke="${INK}" stroke-width="3"/>
    <path d="M30 84c18 0 24-18 18-28-12 0-20 8-18 28z" fill="${color}" stroke="${INK}" stroke-width="3"/>
  </svg>`;
}

let uid = 0;

export interface ArtInput {
  container: string;
  color: string;
  label_color?: string | null;
  fraction: number;
  quantity: number;
  opened?: boolean;
  size_ml?: number | null;
  name: string;
  /** Words that hint at the fruit shape (subcategory, name). */
  hint?: string;
}

export function itemSvg(a: ArtInput): string {
  const lbl = a.label_color ?? 'var(--label)';
  if (a.container === 'fruit') return fruitPieces(a.color, a.quantity, a.hint ?? a.name, a.name);
  if (a.container === 'herb') return herb(a.color, a.name);
  const opaque = OPAQUE[a.container];
  if (opaque) {
    const fill = a.label_color ?? a.color;
    return `<svg viewBox="0 0 60 120" class="bottle opaque" role="img" aria-label="${a.name}">${opaque(
      fill,
      a.color,
      Boolean(a.opened),
      a.size_ml ?? null,
    )}</svg>`;
  }
  const s = SHAPES[a.container] ?? SHAPES.bottle!;
  const id = `b${++uid}`;
  const [top, bottom] = s.liquid;
  const fraction = Math.max(0, Math.min(1, a.fraction));
  const y = bottom - (bottom - top) * fraction;
  const frozen = a.container === 'freezer_bag';
  const liquid = frozen
    ? Array.from({ length: Math.round(fraction * 18) }, (_, k) => {
        const cx = 16 + (k % 4) * 9 + ((k >> 2) % 2) * 4;
        const cy = 108 - Math.floor(k / 4) * 13;
        return `<circle cx="${cx}" cy="${cy}" r="5" fill="${a.color}" stroke="${INK}" stroke-width="1.5"/>`;
      }).join('')
    : `<rect x="0" y="${y}" width="60" height="${120 - y}" fill="${a.color}" class="liquid"/>${
        fraction > 0.02
          ? `<path d="M0 ${y}h60" stroke="${INK}" stroke-width="2.5"/><path d="M0 ${y + 3}h60" stroke="rgba(255,255,255,.6)" stroke-width="2"/>`
          : ''
      }`;
  return `<svg viewBox="0 0 60 120" class="bottle${a.container === 'pet_bottle' ? ' pet' : ''}" role="img" aria-label="${a.name}">
    <defs><clipPath id="${id}"><path d="${s.body}"/></clipPath></defs>
    <path d="${s.body}" class="glass"/>
    <g clip-path="url(#${id})">
      ${liquid}
      <path d="M18 40v66" stroke="rgba(255,255,255,.45)" stroke-width="4" stroke-linecap="round"/>
    </g>
    ${s.extra ? s.extra(lbl) : ''}
    <path d="${s.body}" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
}

/** Default container per category, used where only the category is known. */
export const CATEGORY_CONTAINER: Record<string, string> = {
  spirit: 'bottle',
  liqueur: 'bottle_round',
  wine_aperitif: 'wine_bottle',
  syrup: 'syrup_bottle',
  juice: 'tetra_pak',
  mixer: 'small_bottle',
  fruit: 'fruit',
  garnish: 'herb',
  dairy_cream: 'carton',
  bitters: 'dropper',
  other: 'jar',
};

/** Draws by category (game virtual bottles, recipe heroes). */
export function bottleSvg(
  category: string,
  color: string,
  fraction: number,
  count: number,
  name: string,
): string {
  return itemSvg({
    container: CATEGORY_CONTAINER[category] ?? 'jar',
    color,
    fraction,
    quantity: count,
    name,
  });
}

/** Draws an inventory item with its own container, label color and state. */
export function ingredientSvg(i: {
  display_container: string;
  display_color: string;
  label_color: string | null;
  fill_fraction: number;
  quantity: number;
  opened_at: string | null;
  bottle_size_ml: number | null;
  name: string;
  subcategory: string | null;
}): string {
  return itemSvg({
    container: i.display_container,
    color: i.display_color,
    label_color: i.label_color,
    fraction: i.fill_fraction,
    quantity: i.quantity,
    opened: Boolean(i.opened_at),
    size_ml: i.bottle_size_ml,
    name: i.name,
    hint: `${i.subcategory ?? ''} ${i.name}`,
  });
}

/** Shaky, the mascot: a cocktail shaker with a face. */
export function mascotSvg(mood: 'happy' | 'talk' = 'happy'): string {
  const mouth =
    mood === 'talk'
      ? '<ellipse cx="32" cy="45" rx="5" ry="4" fill="var(--ink)"/>'
      : '<path d="M25 43q7 7 14 0" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>';
  return `<svg viewBox="0 0 64 72" class="mascot" aria-hidden="true">
    <rect x="22" y="2" width="20" height="8" rx="4" fill="var(--hibiscus)" stroke="var(--ink)" stroke-width="3"/>
    <path d="M18 12h28l-3 10H21z" fill="var(--lagoon)" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round"/>
    <path d="M16 24h32l-4 44H20z" fill="var(--mango)" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round"/>
    <path d="M20 30h24" stroke="rgba(255,255,255,.6)" stroke-width="3" stroke-linecap="round"/>
    <circle cx="26" cy="36" r="3.2" fill="var(--ink)"/><circle cx="38" cy="36" r="3.2" fill="var(--ink)"/>
    <circle cx="21" cy="42" r="3" fill="var(--hibiscus)" opacity=".55"/><circle cx="43" cy="42" r="3" fill="var(--hibiscus)" opacity=".55"/>
    ${mouth}
  </svg>`;
}
