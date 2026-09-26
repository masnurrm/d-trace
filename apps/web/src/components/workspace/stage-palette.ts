import type { ProjectStage } from '@dtrace/shared';

/**
 * One colour per project stage, shared by the stepper, the progress bars, the
 * stage badges and the mandays table — so a stage looks the same wherever it
 * appears.
 *
 * **The hue order follows the product design** (the Create Mandays mockup):
 * green, green, amber, blue, violet, pink, reading down the six stages. The
 * six values themselves are unchanged from the set that was checked with the
 * data-viz palette validator; only which stage holds which was re-assigned, so
 * the distinctness that check bought still holds.
 *
 * Prepare and Define are both green on purpose, because the design reads them
 * as one opening phase. They are separated by lightness rather than hue
 * (`#1baf7a` against `#008300`, an L* gap of roughly 22), which survives every
 * form of colour blindness — a hue pair would not have.
 *
 * Three fills sit under 3:1 against a white card. That is allowed here because
 * every one of them is labelled in place — the stepper prints the stage name
 * under the circle, the progress row prints it beside the bar, the table prints
 * it in the row — so the colour never carries the meaning alone.
 */
export const STAGE_FILL: Record<ProjectStage, string> = {
  PREPARE: '#1baf7a',
  DEFINE: '#008300',
  DESIGN: '#eda100',
  DEVELOP: '#2a78d6',
  DEPLOY: '#4a3aa7',
  COMPLETE: '#e87ba4',
};

/**
 * Tinted background plus dark ink, for the stage badge in a table row.
 *
 * A badge is text on a tint, so the bar it has to clear is text contrast, not
 * the fill-against-surface check the solid marks above are held to. Every pair
 * here is a Tailwind 50/700-800 step, comfortably past 4.5:1.
 */
export const STAGE_BADGE: Record<ProjectStage, string> = {
  PREPARE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  DEFINE: 'bg-green-50 text-green-800 ring-green-200',
  DESIGN: 'bg-amber-50 text-amber-800 ring-amber-200',
  DEVELOP: 'bg-blue-50 text-blue-700 ring-blue-200',
  DEPLOY: 'bg-violet-50 text-violet-700 ring-violet-200',
  COMPLETE: 'bg-pink-50 text-pink-700 ring-pink-200',
};

/**
 * A wash behind a whole stage row in the mandays table.
 *
 * Stepped up from the old `50/70`, which was so faint on a white card that the
 * six stages read as one undifferentiated block — the thing the colour is there
 * to prevent. `100/70` is visible at a glance while leaving the bold stage name
 * and its totals comfortably readable on top.
 */
export const STAGE_ROW: Record<ProjectStage, string> = {
  PREPARE: 'bg-emerald-100/70',
  DEFINE: 'bg-green-100/60',
  DESIGN: 'bg-amber-100/70',
  DEVELOP: 'bg-blue-100/70',
  DEPLOY: 'bg-violet-100/70',
  COMPLETE: 'bg-pink-100/70',
};

/**
 * The same stage wash as `STAGE_ROW`, as a flat hex.
 *
 * The Excel export cannot read a Tailwind class, and a spreadsheet has no
 * alpha channel — so these are the `100` steps composited onto white, which is
 * what the reader sees on screen anyway. It lives here rather than in the
 * exporter so a stage keeps one colour everywhere, which is the whole point of
 * this file.
 */
export const STAGE_ROW_HEX: Record<ProjectStage, string> = {
  PREPARE: '#d1fae5',
  DEFINE: '#dcfce7',
  DESIGN: '#fef3c7',
  DEVELOP: '#dbeafe',
  DEPLOY: '#ede9fe',
  COMPLETE: '#fce7f3',
};
