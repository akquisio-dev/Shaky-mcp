import {
  capacityOf,
  glassInfo,
  liquidMl,
  newGame,
  type GameState,
  type GlassShape,
  type ToolVessel,
  type Vessel,
} from '../../../game/index.js';

// Vessels for the mixing game, in the same ink-outline style as the bottles.
// Liquids are drawn as stacked layers inside a clip path of the vessel.

const INK = 'var(--ink)';

interface Shape {
  /** Inner area that holds liquid. */
  inner: string;
  /** Liquid height range [top, bottom] in viewBox units. */
  range: [number, number];
  /** Horizontal span for ice cubes. */
  span: [number, number];
  /** Extra outline drawn on top (stem, base, handle ...). */
  extra?: string;
  /** Drawn above the liquid for opaque vessels (copper mug, tiki mug). */
  skin?: string;
}

const GLASS: Record<GlassShape, Shape> = {
  tall: {
    inner: 'M30 20h60l-4 140a4 4 0 0 1-4 4H38a4 4 0 0 1-4-4z',
    range: [22, 162],
    span: [36, 84],
  },
  short: {
    inner: 'M22 72h76l-4 88a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4z',
    range: [74, 162],
    span: [28, 92],
  },
  coupe: {
    inner: 'M14 52h92c-2 34-22 46-46 46S16 86 14 52z',
    range: [54, 97],
    span: [30, 90],
    extra:
      '<path d="M60 98v56M38 162h44" stroke="var(--ink)" stroke-width="4" stroke-linecap="round" fill="none"/>',
  },
  martini: {
    inner: 'M12 44h96L60 104z',
    range: [46, 102],
    span: [40, 80],
    extra:
      '<path d="M60 104v52M38 162h44" stroke="var(--ink)" stroke-width="4" stroke-linecap="round" fill="none"/>',
  },
  hurricane: {
    inner: 'M36 16h48c12 40-6 66-6 84 0 12 4 22 8 30H34c4-8 8-18 8-30 0-18-18-44-6-84z',
    range: [18, 128],
    span: [42, 78],
    extra:
      '<path d="M60 130v22M40 162h40M48 154h24" stroke="var(--ink)" stroke-width="4" stroke-linecap="round" fill="none"/>',
  },
  tiki: {
    inner: 'M26 22h68l-4 136a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6z',
    range: [24, 162],
    span: [34, 86],
    skin: '<path d="M26 40h68l-4 118a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6z" fill="#8a5a2b" opacity=".55"/><path d="M40 70h14M66 70h14M44 96q16 14 32 0M48 120h24" stroke="var(--ink)" stroke-width="4" stroke-linecap="round" fill="none"/>',
  },
  mug: {
    inner: 'M24 40h68v116a8 8 0 0 1-8 8H32a8 8 0 0 1-8-8z',
    range: [42, 162],
    span: [30, 86],
    extra:
      '<path d="M92 66h10a10 10 0 0 1 10 10v36a10 10 0 0 1-10 10H92" fill="none" stroke="var(--ink)" stroke-width="4"/>',
    skin: '<path d="M24 56h68v100a8 8 0 0 1-8 8H32a8 8 0 0 1-8-8z" fill="#c8733a" opacity=".55"/>',
  },
  wine: {
    inner: 'M28 20h64c4 44-6 72-32 72S24 64 28 20z',
    range: [22, 91],
    span: [36, 84],
    extra:
      '<path d="M60 92v62M38 162h44" stroke="var(--ink)" stroke-width="4" stroke-linecap="round" fill="none"/>',
  },
  flute: {
    inner: 'M46 12h28l-3 92c-1 8-21 8-22 0z',
    range: [14, 108],
    span: [50, 70],
    extra:
      '<path d="M60 110v44M42 162h36" stroke="var(--ink)" stroke-width="4" stroke-linecap="round" fill="none"/>',
  },
  shot: {
    inner: 'M38 104h44l-4 56a4 4 0 0 1-4 4H46a4 4 0 0 1-4-4z',
    range: [106, 162],
    span: [44, 76],
  },
};

const TOOL: Record<ToolVessel, Shape> = {
  shaker: {
    inner: 'M22 46h56l-8 114a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4z',
    range: [48, 162],
    span: [30, 70],
    extra:
      '<path d="M26 46c0-14 10-22 24-22s24 8 24 22z" fill="var(--paper-2)" stroke="var(--ink)" stroke-width="4"/><rect x="42" y="10" width="16" height="16" rx="4" fill="var(--hibiscus)" stroke="var(--ink)" stroke-width="4"/>',
  },
  blender: {
    inner: 'M18 14h64l-8 112H26z',
    range: [16, 124],
    span: [26, 74],
    extra:
      '<rect x="16" y="126" width="68" height="38" rx="8" fill="var(--lagoon)" stroke="var(--ink)" stroke-width="4"/><circle cx="50" cy="145" r="7" fill="var(--paper)" stroke="var(--ink)" stroke-width="3"/>',
  },
  mixing_glass: {
    inner: 'M16 50h68v108a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6z',
    range: [52, 162],
    span: [22, 78],
    extra: '<path d="M16 50l-8-6" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/>',
  },
};

let uid = 0;

function iceSvg(v: Vessel, shape: Shape): string {
  if (v.ice <= 0) return '';
  const [x0, x1] = shape.span;
  const [, bottom] = shape.range;
  const size = v.crushed ? 8 : 16;
  const perRow = Math.max(1, Math.floor((x1 - x0) / (size + 2)));
  const n = v.crushed ? v.ice * 3 : v.ice;
  let out = '';
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = x0 + col * (size + 2) + (row % 2) * 4;
    const y = bottom - (row + 1) * (size + 1);
    out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size / 4}" fill="rgba(255,255,255,.55)" stroke="rgba(42,24,16,.45)" stroke-width="1.5" transform="rotate(${((i * 37) % 20) - 10} ${x + size / 2} ${y + size / 2})"/>`;
  }
  return out;
}

function solidsSvg(v: Vessel, shape: Shape): string {
  const [x0, x1] = shape.span;
  const [, bottom] = shape.range;
  let out = '';
  let i = 0;
  for (const s of v.solids) {
    for (let k = 0; k < Math.min(s.count, 8); k++, i++) {
      const x = x0 + ((i * 17) % Math.max(10, x1 - x0));
      const y = bottom - 8 - (i % 3) * 6;
      out += `<ellipse cx="${x}" cy="${y}" rx="${v.muddled_s > 0 ? 4 : 6}" ry="4" fill="${s.color}" stroke="${INK}" stroke-width="1.5"/>`;
    }
  }
  return out;
}

function liquidSvg(v: Vessel, shape: Shape, capacity: number): string {
  const [top, bottom] = shape.range;
  const h = bottom - top;
  let y = bottom;
  let out = '';
  for (const l of v.layers) {
    const lh = (l.ml / capacity) * h;
    y -= lh;
    out += `<rect class="layer" x="0" y="${y}" width="120" height="${lh + 0.5}" fill="${l.color}"/>`;
  }
  if (v.layers.length) {
    out += `<path d="M0 ${y}h120" stroke="${INK}" stroke-width="2.5"/><path d="M0 ${y + 3}h120" stroke="rgba(255,255,255,.6)" stroke-width="2"/>`;
  }
  return out;
}

function vesselSvg(
  shape: Shape,
  v: Vessel,
  capacity: number,
  label: string,
  extraTop = '',
  cls = '',
): string {
  const id = `v${++uid}`;
  return `<svg viewBox="0 0 120 170" class="vessel ${cls}" role="img" aria-label="${label}">
    <defs><clipPath id="${id}"><path d="${shape.inner}"/></clipPath></defs>
    <path d="${shape.inner}" class="glass-fill"/>
    <g clip-path="url(#${id})">
      ${liquidSvg(v, shape, capacity)}
      ${iceSvg(v, shape)}
      ${solidsSvg(v, shape)}
      <path d="M36 30v120" stroke="rgba(255,255,255,.5)" stroke-width="5" stroke-linecap="round"/>
    </g>
    ${shape.skin ?? ''}
    ${shape.extra ?? ''}
    <path d="${shape.inner}" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    ${extraTop}
  </svg>`;
}

function garnishSvg(state: GameState): string {
  return state.garnishes
    .slice(0, 4)
    .map((g, i) => {
      const x = 88 - i * 14;
      return `<g transform="translate(${x} ${glassTop(state) - 6})"><path d="M0 0a12 12 0 0 1 24 0z" fill="${g.color}" stroke="${INK}" stroke-width="3"/><path d="M12 0V-10" stroke="var(--palm)" stroke-width="3" stroke-linecap="round"/></g>`;
    })
    .join('');
}

function glassTop(state: GameState): number {
  const shape = GLASS[glassInfo(state.glass).shape];
  return shape.range[0];
}

export function glassArt(state: GameState, label: string): string {
  const shape = GLASS[glassInfo(state.glass).shape];
  const frost = state.chilled
    ? '<path d="M28 30h64" stroke="rgba(255,255,255,.8)" stroke-width="3" stroke-dasharray="2 6"/>'
    : '';
  return vesselSvg(
    shape,
    state.vessels.glass,
    capacityOf(state, 'glass'),
    label,
    garnishSvg(state) + frost,
    state.chilled ? 'chilled' : '',
  );
}

export function toolArt(state: GameState, tool: ToolVessel, label: string): string {
  return vesselSvg(
    TOOL[tool],
    state.vessels[tool],
    capacityOf(state, tool),
    label,
    '',
    `tool-${tool}`,
  );
}

/** Small glass icon for the glass picker. */
export function glassIcon(type: string): string {
  const shape = GLASS[glassInfo(type).shape];
  return `<svg viewBox="0 0 120 170" class="glass-icon" aria-hidden="true"><path d="${shape.inner}" fill="var(--glass)" stroke="${INK}" stroke-width="6"/>${shape.extra ?? ''}</svg>`;
}

export const iceBucketSvg = `<svg viewBox="0 0 60 120" class="bottle" aria-hidden="true">
  <path d="M8 60h44l-5 52a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4z" fill="var(--lagoon)" stroke="var(--ink)" stroke-width="3"/>
  <rect x="14" y="48" width="14" height="14" rx="3" fill="#fff" stroke="var(--ink)" stroke-width="2" transform="rotate(-12 21 55)"/>
  <rect x="30" y="46" width="14" height="14" rx="3" fill="#fff" stroke="var(--ink)" stroke-width="2" transform="rotate(10 37 53)"/>
  <path d="M8 60h44" stroke="var(--ink)" stroke-width="3"/>
</svg>`;

export { liquidMl };

/** A recipe's glass filled with the drink's color, for recipe pages. */
export function filledGlassSvg(
  glass: string | null | undefined,
  color: string,
  name: string,
): string {
  const s = newGame(glass ?? 'highball');
  const v = s.vessels.glass;
  v.ice = 4;
  v.layers.push({ key: 'drink', label: name, color, ml: capacityOf(s, 'glass') * 0.7 });
  return glassArt(s, name);
}
