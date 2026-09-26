import type { BadgeProps } from '@/components/ui/badge';

export interface ActionDescription {
  label: string;
  tone: NonNullable<BadgeProps['tone']>;
}

/**
 * Actions whose Indonesian name is not just the verb in their suffix.
 *
 * The sign-in and refresh codes are no longer written - the trail records row
 * changes only - but rows already carrying them stay in the table and still
 * have to render with a name rather than a bare constant.
 */
const EXACT: Record<string, ActionDescription> = {
  AUTH_LOGIN: { label: 'Masuk', tone: 'neutral' },
  AUTH_LOGIN_FAILED: { label: 'Gagal masuk', tone: 'danger' },
  AUTH_LOGOUT: { label: 'Keluar', tone: 'neutral' },
  AUTH_REFRESH: { label: 'Perpanjang sesi', tone: 'neutral' },
  AUTH_REGISTER: { label: 'Daftar', tone: 'primary' },
  AUTH_PASSWORD_CHANGED: { label: 'Ganti password', tone: 'warning' },
  SETTINGS_EMAIL_TESTED: { label: 'Uji email', tone: 'neutral' },
};

/** Checked in order, so `_DUPLICATED` is matched before `_CREATED` cannot be. */
const BY_SUFFIX: [string, ActionDescription][] = [
  ['_DUPLICATED', { label: 'Digandakan', tone: 'info' }],
  ['_CREATED', { label: 'Dibuat', tone: 'primary' }],
  ['_DELETED', { label: 'Dihapus', tone: 'danger' }],
  ['_MOVED', { label: 'Dipindah', tone: 'info' }],
  ['_UPDATED', { label: 'Diubah', tone: 'neutral' }],
  ['_CHANGED', { label: 'Diubah', tone: 'neutral' }],
];

/**
 * The Indonesian label and colour for an audit action.
 *
 * The verb alone is what the column shows — the noun is already in the Entity
 * column beside it, so "NODE_CREATED" reads as "Dibuat · Node". The raw code is
 * never thrown away: it stays in the badge's tooltip and in the detail dialog,
 * because a trail that only shows a prettified label is harder to trust as
 * evidence. An action with no mapping falls back to its own code.
 */
export function describeAction(action: string): ActionDescription {
  const exact = EXACT[action];
  if (exact) return exact;

  for (const [suffix, description] of BY_SUFFIX) {
    if (action.endsWith(suffix)) return description;
  }

  return { label: action, tone: 'neutral' };
}
