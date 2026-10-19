function parse(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1]!, 16) : 0xcccccc;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number[]) =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Volume-weighted color mix of several liquids. */
export function mixColors(parts: { color: string; ml: number }[]): string {
  const total = parts.reduce((s, p) => s + p.ml, 0);
  if (total <= 0) return '#e8f6fa';
  const acc = [0, 0, 0];
  for (const p of parts) {
    const c = parse(p.color);
    for (let i = 0; i < 3; i++) acc[i]! += c[i]! * (p.ml / total);
  }
  return toHex(acc);
}

export const WATER = { key: 'water', label: 'water', color: '#e4f3f8' };
