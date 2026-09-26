import type { Metadata } from 'next';
import { ROLES, hasAtLeastRole, type NodeTypeView, type NodeView, type Role } from '@dtrace/shared';
import { apiFetch, getSessionUser } from '@/lib/api/server';
import { HierarchyExplorer } from '@/components/hierarchy/hierarchy-explorer';

export const metadata: Metadata = { title: 'Hierarki' };
export const dynamic = 'force-dynamic';

export default async function HierarchyPage() {
  // Three independent reads; no reason to make them wait for each other.
  const [user, nodes, types] = await Promise.all([
    getSessionUser(),
    apiFetch<NodeView[]>('/nodes?includeInactive=true'),
    apiFetch<NodeTypeView[]>('/node-types?includeInactive=true'),
  ]);

  const canEdit = hasAtLeastRole((user?.role ?? ROLES.VIEWER) as Role, ROLES.ADMIN);

  return (
    <HierarchyExplorer initialNodes={nodes.data} initialTypes={types.data} canEdit={canEdit} />
  );
}
