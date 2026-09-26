import type { Metadata } from 'next';
import type { NodeTypeView } from '@dtrace/shared';
import { apiFetch } from '@/lib/api/server';
import { NodeTypesManager } from '@/components/hierarchy/node-types-manager';

export const metadata: Metadata = { title: 'Jenis Node' };
export const dynamic = 'force-dynamic';

export default async function NodeTypesPage() {
  // Fetched here so the list is in the first paint; the client query then
  // takes over and keeps it fresh after every change.
  const { data } = await apiFetch<NodeTypeView[]>('/node-types?includeInactive=true');

  return <NodeTypesManager initialTypes={data} />;
}
