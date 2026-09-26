'use client';

import { cn } from '@/lib/utils/cn';

/** `Budi Workspace` → `BW`; a single word gives its first two letters. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * A deterministic tint per person, so the same face keeps the same colour
 * everywhere it appears. Derived from the id rather than from the list
 * position, which would reshuffle every time someone joins or leaves.
 */
const TINTS = [
  'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200',
  'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200',
] as const;

function tintFor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return TINTS[hash % TINTS.length]!;
}

export interface TeamAvatarsProps {
  members: { userId: string; name: string; email: string }[];
  onOpen: () => void;
  /** How many faces to draw before collapsing the rest into a count. */
  max?: number;
}

/**
 * The team as a row of faces under the project title.
 *
 * Three initials and a `+N` rather than a list: the point of this row is to
 * answer "roughly who is on this, and how many" at a glance. The names
 * themselves live in the dialog it opens, where there is room to show the
 * roles that make them meaningful.
 */
export function TeamAvatars({ members, onOpen, max = 3 }: TeamAvatarsProps) {
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Tim project — ${members.length} anggota. Buka daftar tim.`}
      // Bordered rather than bare: it sits beside three real buttons now, and
      // a row of faces with nothing around it reads as decoration instead of a
      // control. The pointer says the same thing to the mouse.
      className="group flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-xs transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800"
    >
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Team</span>

      {members.length === 0 ? (
        <span className="text-xs text-slate-500">Belum ada anggota</span>
      ) : (
        <span className="flex -space-x-2">
          {shown.map((member) => (
            <span
              key={member.userId}
              title={`${member.name} · ${member.email}`}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-white dark:ring-slate-900',
                tintFor(member.userId),
              )}
            >
              {initialsOf(member.name)}
            </span>
          ))}

          {overflow > 0 && (
            <span
              title={`${overflow} anggota lainnya`}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600 ring-2 ring-white dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-900"
            >
              +{overflow}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
