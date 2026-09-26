/**
 * The dashboard's colours, and the order they are drawn in.
 *
 * Every set below was checked with the data-viz palette validator rather than
 * picked by eye. Two results are worth keeping in mind before editing:
 *
 *  - **Order is part of the palette.** The workflow set's worst colour-blind
 *    separation went from ΔE 6.3 to 13.0 purely by moving amber away from
 *    green. Reordering these arrays can break the chart for a protanope
 *    without changing a single hex.
 *  - **Blue and violet cannot sit next to each other on the dark card.** They
 *    measure ΔE 9.8 to normal vision there, below the floor of 15 - which is
 *    why the hero uses aqua where the light charts use blue.
 */

export interface Slice {
  key: string;
  label: string;
  color: string;
}

/**
 * Workflow states, ordered blocked → waiting → ready → running → done.
 *
 * The neutral grey is deliberately not a hue: it means "nothing has happened
 * yet", and the validator flags it as reading grey, which is the point. The
 * five coloured slots pass every check on the light surface.
 */
export const NEUTRAL = '#94a3b8';
export const BLOCKED = '#d03b3b';
export const HOLD = '#eda100';
export const READY = '#2a78d6';
export const RUNNING = '#4a3aa7';
export const DONE = '#0ca30c';

/**
 * The stacked bar and status cards on the dark hero.
 *
 * Stepped for a dark surface rather than flipped from the light set - all five
 * clear 3:1 against it, and none of the adjacent pairs collide.
 */
export const HERO_COLORS = {
  blocked: '#c98500',
  development: '#9085e9',
  testing: '#199e70',
  reopened: '#e66767',
  ready: '#008300',
} as const;

/**
 * Identity colours for people, in fixed order.
 *
 * Assigned by position and never cycled: a ninth assignee folds into "Lainnya"
 * rather than reusing slot 1, because two people sharing a colour is worse than
 * one bucket that admits it is a bucket.
 */
export const CATEGORICAL = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
] as const;

export const CATEGORICAL_OVERFLOW = NEUTRAL;
