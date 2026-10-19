// All artwork is drawn here from scratch: simple shapes, thick ink outlines,
// liquid in the ingredient's own color. The same shapes will become the
// draggable bottles of the stage-2 mixing game.

const INK = 'var(--ink)';

interface Shape {
  /** Outline path of the container. */
  body: string;
  /** Inner area that holds liquid: [top, bottom] in viewBox units. */
  liquid: [number, number];
  /** Optional cap / label decoration drawn on top. */
  extra?: string;
}

// viewBox 0 0 60 120 for every shape, bottoms at y=116.
const SHAPES: Record<string, Shape> = {
  spirit: {
    body: 'M24 4h12v22c0 4 12 8 12 20v66a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V46c0-12 12-16 12-20z',
    liquid: [46, 114],
    extra:
      '<rect x="22" y="2" width="16" height="8" rx="2" class="cap"/><rect x="16" y="62" width="28" height="26" rx="3" class="label"/>',
  },
  liqueur: {
    body: 'M25 6h10v20c10 4 18 14 18 30v54a6 6 0 0 1-6 6H13a6 6 0 0 1-6-6V56c0-16 8-26 18-30z',
    liquid: [40, 114],
    extra:
      '<rect x="23" y="2" width="14" height="9" rx="3" class="cap"/><circle cx="30" cy="78" r="13" class="label"/>',
  },
  wine_aperitif: {
    body: 'M26 4h8v30c0 6 14 10 14 24v54a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V58c0-14 14-18 14-24z',
    liquid: [52, 114],
    extra:
      '<rect x="25" y="2" width="10" height="14" rx="2" class="cap"/><rect x="16" y="72" width="28" height="22" rx="2" class="label"/>',
  },
  syrup: {
    body: 'M26 4h8v30c0 4 10 6 10 16v62a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V50c0-10 10-12 10-16z',
    liquid: [44, 114],
    extra:
      '<rect x="24" y="2" width="12" height="8" rx="2" class="cap"/><rect x="18" y="66" width="24" height="30" rx="3" class="label"/>',
  },
  bitters: {
    body: 'M26 40h8v10c6 2 12 6 12 14v48a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V64c0-8 6-12 12-14z',
    liquid: [60, 114],
    extra:
      '<rect x="24" y="34" width="12" height="10" rx="2" class="cap"/><rect x="14" y="74" width="32" height="26" rx="2" class="label"/>',
  },
  mixer: {
    body: 'M27 24h6v8c0 4 9 6 9 14v66a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V46c0-8 9-10 9-14z',
    liquid: [44, 114],
    extra:
      '<rect x="25" y="20" width="10" height="7" rx="2" class="cap"/><rect x="18" y="70" width="24" height="18" class="label"/>',
  },
  juice: {
    body: 'M12 30l8-14h20l8 14v82a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z',
    liquid: [32, 114],
    extra:
      '<rect x="33" y="8" width="8" height="10" rx="2" class="cap"/><path d="M12 30h36" fill="none" stroke="var(--ink)" stroke-width="3"/>',
  },
  dairy_cream: {
    body: 'M14 34l6-16h20l6 16v78a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z',
    liquid: [36, 114],
    extra:
      '<path d="M14 34h32" fill="none" stroke="var(--ink)" stroke-width="3"/><circle cx="30" cy="76" r="9" class="label"/>',
  },
  other: {
    body: 'M14 44h32v68a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z',
    liquid: [48, 114],
    extra: '<rect x="11" y="34" width="38" height="12" rx="3" class="cap"/>',
  },
};

function fruit(color: string, count: number, label: string): string {
  const n = Math.max(1, Math.min(3, Math.ceil(count)));
  const spots = [
    [30, 92],
    [16, 100],
    [44, 100],
  ].slice(0, n);
  return `<svg viewBox="0 0 60 120" class="bottle fruit" role="img" aria-label="${label}">
    ${spots
      .map(
        ([x, y]) =>
          `<g><ellipse cx="${x}" cy="${y}" rx="14" ry="13" fill="${color}" stroke="${INK}" stroke-width="3"/>
           <path d="M${x! - 5} ${y! - 4}q5-5 10 0" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="3" stroke-linecap="round"/>
           <path d="M${x} ${y! - 13}q4-8 10-8" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/></g>`,
      )
      .join('')}
  </svg>`;
}

function leaf(color: string, label: string): string {
  return `<svg viewBox="0 0 60 120" class="bottle fruit" role="img" aria-label="${label}">
    <path d="M30 116V64" stroke="${INK}" stroke-width="3" fill="none"/>
    <path d="M30 96c-20 0-24-20-18-30 12 0 20 10 18 30z" fill="${color}" stroke="${INK}" stroke-width="3"/>
    <path d="M30 84c18 0 24-18 18-28-12 0-20 8-18 28z" fill="${color}" stroke="${INK}" stroke-width="3"/>
  </svg>`;
}

let uid = 0;

/** A container drawn with liquid up to `fraction` (0..1) in `color`. */
export function bottleSvg(
  category: string,
  color: string,
  fraction: number,
  count: number,
  label: string,
): string {
  if (category === 'fruit') return fruit(color, count, label);
  if (category === 'garnish') return leaf(color, label);
  const s = SHAPES[category] ?? SHAPES.other!;
  const id = `b${++uid}`;
  const [top, bottom] = s.liquid;
  const y = bottom - (bottom - top) * Math.max(0, Math.min(1, fraction));
  return `<svg viewBox="0 0 60 120" class="bottle" role="img" aria-label="${label}">
    <defs><clipPath id="${id}"><path d="${s.body}"/></clipPath></defs>
    <path d="${s.body}" class="glass"/>
    <g clip-path="url(#${id})">
      <rect x="0" y="${y}" width="60" height="${120 - y}" fill="${color}" class="liquid"/>
      ${fraction > 0.02 ? `<path d="M0 ${y}h60" stroke="${INK}" stroke-width="2.5"/><path d="M0 ${y + 3}h60" stroke="rgba(255,255,255,.6)" stroke-width="2"/>` : ''}
      <path d="M18 40v66" stroke="rgba(255,255,255,.45)" stroke-width="4" stroke-linecap="round"/>
    </g>
    ${s.extra ?? ''}
    <path d="${s.body}" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
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
