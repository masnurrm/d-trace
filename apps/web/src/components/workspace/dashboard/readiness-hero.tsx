'use client';

import { HERO_COLORS } from './palette';
import type { TaskCounts } from './dashboard-data';

export interface HeroBucket {
  key: keyof typeof HERO_COLORS;
  label: string;
  value: number;
  caption: string;
}

/**
 * Rolls the two per-stage breakdowns into the five buckets a reader actually
 * asks about.
 *
 * Dev status and test status are two columns; what a lead wants is one answer
 * per task. The order below is the order of the pipeline, and a task lands in
 * the first bucket it qualifies for - so a re-opened task is re-opened, not
 * "in development", even though both are true of it.
 */
export function toHeroBuckets(counts: TaskCounts): HeroBucket[] {
  return [
    {
      key: 'blocked',
      label: 'Terhambat',
      value: counts.dev.unready + counts.dev.waitingConfirm,
      caption: 'Unready for Dev atau Waiting confirmUser',
    },
    {
      key: 'development',
      label: 'Development',
      value: counts.dev.ready + counts.dev.inProgress,
      caption: 'Ready for Dev atau InProgress Dev',
    },
    {
      key: 'testing',
      label: 'Testing',
      value: counts.test.ready + counts.test.inProgress,
      caption: 'Closed Dev, test belum selesai',
    },
    {
      key: 'reopened',
      label: 'Re-Opened',
      value: counts.test.reopened,
      caption: 'Hasil test dikembalikan ke dev',
    },
    {
      key: 'ready',
      label: 'Siap SIT/UAT',
      value: counts.test.closed,
      caption: 'Closed Dev dan Closed Test',
    },
  ];
}

/**
 * The headline: how much of the project is through development and testing.
 *
 * A single number is the right form here - the five buckets under it are the
 * breakdown, not five competing figures. The bar is the same five values in
 * proportion, so the eye can check the headline against the split without
 * reading any of the counts.
 */
export function ReadinessHero({ counts }: { counts: TaskCounts }) {
  const buckets = toHeroBuckets(counts);
  const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0);
  const done = buckets.find((bucket) => bucket.key === 'ready')?.value ?? 0;
  const share = total === 0 ? 0 : (done / total) * 100;

  return (
    <section className="rounded-xl bg-slate-900 p-6 text-slate-100">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div>
          <h2 className="text-sm font-semibold text-slate-300">Siap lanjut ke SIT/UAT</h2>
          <p className="mt-2 flex items-baseline gap-1">
            <span
              className="text-6xl font-extrabold tracking-tight"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {share.toLocaleString('id-ID', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            </span>
            <span className="text-2xl font-bold text-slate-400">%</span>
          </p>
          <p className="mt-2 text-sm text-slate-400">
            <span className="font-semibold text-slate-200">{done}</span> dari{' '}
            <span className="font-semibold text-slate-200">{total}</span> task sudah Closed Dev dan
            Closed Test
          </p>
        </div>

        <div className="space-y-4">
          {/* Same five values as the cards below, in proportion. */}
          <div
            className="flex h-4 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={`Sebaran ${total} task menurut status internal`}
          >
            {buckets.map((bucket) =>
              bucket.value <= 0 ? null : (
                <span
                  key={bucket.key}
                  title={`${bucket.label}: ${bucket.value}`}
                  style={{
                    backgroundColor: HERO_COLORS[bucket.key],
                    flexGrow: bucket.value,
                  }}
                  className="first:rounded-l-full last:rounded-r-full"
                />
              ),
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {buckets.map((bucket) => (
              <div
                key={bucket.key}
                className="rounded-lg border-t-4 bg-slate-800/60 p-3"
                style={{ borderTopColor: HERO_COLORS[bucket.key] }}
              >
                <p className="text-sm font-semibold text-slate-200">{bucket.label}</p>
                <p
                  className="text-2xl font-bold text-white"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {bucket.value}
                </p>
                <p className="mt-1 text-xs leading-snug text-slate-400">{bucket.caption}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <details className="mt-5 text-sm text-slate-400">
        <summary className="cursor-pointer select-none hover:text-slate-200">
          Cara status internal ditentukan dari status Dev dan Test
        </summary>
        <ul className="mt-3 space-y-1.5 pl-4 text-slate-400">
          <li>
            Sebuah task masuk ke bucket <em>pertama</em> yang cocok, dari atas ke bawah — jadi task
            yang di-reopen dihitung sebagai Re-Opened, bukan Development.
          </li>
          <li>
            <strong className="text-slate-200">Terhambat</strong> — Unready for Dev atau menunggu
            konfirmasi user.
          </li>
          <li>
            <strong className="text-slate-200">Development</strong> — sudah siap dikerjakan atau
            sedang dikerjakan.
          </li>
          <li>
            <strong className="text-slate-200">Testing</strong> — dev selesai, test belum selesai.
          </li>
          <li>
            <strong className="text-slate-200">Re-Opened</strong> — test menemukan masalah dan
            mengembalikannya ke dev.
          </li>
          <li>
            <strong className="text-slate-200">Siap SIT/UAT</strong> — Closed Dev dan Closed Test.
          </li>
        </ul>
      </details>
    </section>
  );
}
