import type { Metadata } from 'next';
import type { AuditLog } from '@dtrace/shared';
import { apiFetch } from '@/lib/api/server';
import { AuditPanel } from '@/components/audit/audit-panel';
import { auditSearchString } from '@/components/audit/query';

export const metadata: Metadata = { title: 'Audit Log' };
export const dynamic = 'force-dynamic';

/** Prefetches the first page; the panel owns everything after that. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') incoming.set(key, value);
  }

  const search = auditSearchString(incoming);
  const initialResult = await apiFetch<AuditLog[]>(`/audit-logs?${search}`);

  return (
    // The filter card carries the page title, so a PageHeader above it would
    // just say Audit Log twice.
    <AuditPanel initialSearch={search} initialResult={initialResult} />
  );
}
