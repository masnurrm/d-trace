'use client';

import { cn } from '@/lib/utils/cn';

export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  data: DonutDatum[];
  /** The one number the chart exists to deliver, shown in the hole. */
  centerValue: string;
  centerCaption: string;
  /** Caps the legend height and lets the rest scroll, as a long roster must. */
  scrollLegend?: boolean;
  className?: string;
}

const SIZE = 132;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Surface-coloured gap between segments; the spec asks for 2px. */
const GAP = 2;

const percent = (value: number, total: number) => (total === 0 ? 0 : (value / total) * 100);

const formatPercent = (value: number) =>
  `${value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/**
 * A part-to-whole ring with the numbers in the legend beside it.
 *
 * The ring is the shape of the split; the legend is where the values actually
 * get read, which is why every row carries its count and its share. That also
 * satisfies the relief rule for the two fills that sit under 3:1 against a
 * white card - the meaning never rests on the colour alone.
 *
 * Segments with a zero count are dropped rather than drawn as a hairline, and
 * they keep their legend row so the reader can tell "none" from "missing".
 */
export function DonutChart({
  data,
  centerValue,
  centerCaption,
  scrollLegend = false,
  className,
}: DonutChartProps) {
  const total = data.reduce((sum, datum) => sum + datum.value, 0);

  // Offsets accumulate, so the arcs are laid end to end around the ring.
  let consumed = 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-6', className)}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${centerCaption}: ${centerValue}`}
        className="shrink-0"
      >
        {/* The track keeps the ring readable when everything is zero. */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className="text-slate-100"
        />

        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {data.map((datum) => {
            if (datum.value <= 0) return null;

            const length = (datum.value / total) * CIRCUMFERENCE;
            const offset = -consumed;
            consumed += length;

            return (
              <circle
                key={datum.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={datum.color}
                strokeWidth={STROKE}
                // The gap is taken out of the arc, not added between arcs, so
                // the ring still closes at exactly 100%.
                strokeDasharray={`${Math.max(length - GAP, 0.5)} ${CIRCUMFERENCE}`}
                strokeDashoffset={offset}
              >
                <title>{`${datum.label}: ${datum.value} (${formatPercent(percent(datum.value, total))})`}</title>
              </circle>
            );
          })}
        </g>

        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          className="fill-slate-900 text-[19px] font-bold"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {centerValue}
        </text>
        <text x="50%" y="62%" textAnchor="middle" className="fill-slate-500 text-[9px]">
          {centerCaption}
        </text>
      </svg>

      <ul
        className={cn(
          'min-w-0 flex-1 space-y-1.5 text-sm',
          scrollLegend && 'max-h-40 overflow-y-auto pr-2',
        )}
      >
        {data.map((datum) => (
          <li key={datum.key} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: datum.color }}
            />
            <span className="min-w-0 flex-1 truncate text-slate-600">{datum.label}</span>
            <span
              className="w-8 shrink-0 text-right font-semibold text-slate-900"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {datum.value}
            </span>
            <span
              className="w-14 shrink-0 text-right text-slate-500"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatPercent(percent(datum.value, total))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
