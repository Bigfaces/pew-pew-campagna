// ================================================================
// PALETTE
// ================================================================
// Entities carry a `skin` index rather than colour strings, so
// snapshots stay compact and every peer renders the same player the
// same colour. Resolution to actual colours happens only here.
// ================================================================

import type { PowerUpKind } from '../sim/types';

export interface Skin {
  name: string;
  body: string;
  trim: string;
  /** Pre-parsed for particle tinting. */
  rgb: [number, number, number];
}

export const SKINS: readonly Skin[] = [
  { name: 'AZZURRO', body: '#3a88ff', trim: '#8dc2ff', rgb: [58, 136, 255] },
  { name: 'CREMISI', body: '#e83030', trim: '#ff7a68', rgb: [232, 48, 48] },
  { name: 'AMBRA', body: '#e08820', trim: '#ffcc4a', rgb: [224, 136, 32] },
  { name: 'GIADA', body: '#22c98a', trim: '#5fe9bb', rgb: [34, 201, 138] },
  { name: 'VIOLA', body: '#a259e8', trim: '#c99cff', rgb: [162, 89, 232] },
  { name: 'ROSA', body: '#ec4899', trim: '#ff92c4', rgb: [236, 72, 153] },
  { name: 'CIANO', body: '#22c5d6', trim: '#6ceaf5', rgb: [34, 197, 214] },
  { name: 'LIME', body: '#9bcf35', trim: '#c8ef70', rgb: [155, 207, 53] },
];

export function skinOf(index: number): Skin {
  return SKINS[index % SKINS.length]!;
}

export const PU_COLOR: Record<PowerUpKind, string> = {
  speed: '#ffe022',
  rapidfire: '#ff7722',
  shield: '#44ccff',
};

export const PU_RGB: Record<PowerUpKind, [number, number, number]> = {
  speed: [255, 224, 34],
  rapidfire: [255, 119, 34],
  shield: [68, 204, 255],
};

export const PU_LABEL: Record<PowerUpKind, string> = {
  speed: 'VELOCITÀ',
  rapidfire: 'FUOCO RAPIDO',
  shield: 'SCUDO',
};

/** Multiply a hex colour by a scalar and return an rgb() string. */
export function shade(hex: string, k: number): string {
  const r = parseInt(hex.slice(1, 3), 16) * k;
  const g = parseInt(hex.slice(3, 5), 16) * k;
  const b = parseInt(hex.slice(5, 7), 16) * k;
  return `rgb(${Math.round(Math.min(255, r))},${Math.round(Math.min(255, g))},${Math.round(Math.min(255, b))})`;
}
