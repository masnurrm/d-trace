'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import {
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  buildTree,
  collectDescendantIds,
  type NodeView,
  type ProjectRole,
  type TreeNode,
} from '@dtrace/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectControl } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';

export interface NodeAccessDraft {
  role: ProjectRole;
  canCreateDocument: boolean;
}

interface NodeAccessPickerProps {
  nodes: NodeView[];
  /** nodeId -> what this person is at that node. Absent means no access. */
  value: Map<string, NodeAccessDraft>;
  onChange: (next: Map<string, NodeAccessDraft>) => void;
  disabled?: boolean;
}

const ROLE_OPTIONS = PROJECT_ROLES.map((role) => ({
  value: role,
  label: PROJECT_ROLE_LABELS[role],
}));

/**
 * Picks the nodes a person may reach, and what they are at each one.
 *
 * The ticking rule, which is the whole point of this control:
 *
 *  - ticking a node also ticks everything **below** it, because granting IAMI
 *    and then hand-ticking its six apps is busywork;
 *  - it does **not** tick anything above it — reaching IAMI says nothing about
 *    reaching ASMO3, and quietly widening access upwards is how people end up
 *    seeing more than anyone meant;
 *  - descendants stay individually editable afterwards. The tick is a
 *    shortcut, not a lock: granting IAMI and then removing ESS-IT has to work,
 *    so nothing below is disabled or forced to follow.
 *
 * Each ticked node carries its own role, so the same person can be a Manager
 * at one branch and a Viewer at another.
 */
export function NodeAccessPicker({ nodes, value, onChange, disabled }: NodeAccessPickerProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return buildTree(nodes);

    // Keep ancestors of every match, or a deep hit disappears with its parent.
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const keep = new Set<string>();

    for (const node of nodes) {
      if (
        !node.name.toLowerCase().includes(query) &&
        !node.code.toLowerCase().includes(query)
      ) {
        continue;
      }
      keep.add(node.id);
      let parentId = node.parentId;
      while (parentId && !keep.has(parentId)) {
        keep.add(parentId);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
    }

    return buildTree(nodes.filter((node) => keep.has(node.id)));
  }, [nodes, search]);

  function setAccess(nodeId: string, draft: NodeAccessDraft | null) {
    const next = new Map(value);
    if (draft) next.set(nodeId, draft);
    else next.delete(nodeId);
    onChange(next);
  }

  /**
   * Sets a role on a node and pushes it down the branch.
   *
   * Only nodes that are already ticked are touched — the role follows access,
   * it does not hand it out. Each descendant stays editable afterwards, so a
   * branch can be Admin everywhere except one app.
   */
  function setRoleCascading(nodeId: string, role: ProjectRole) {
    const next = new Map(value);
    const current = next.get(nodeId);

    next.set(nodeId, {
      role,
      // Only a Collaborator can hold this, so it resets on the way out.
      canCreateDocument: role === 'COLLABORATOR' ? (current?.canCreateDocument ?? false) : false,
    });

    for (const id of collectDescendantIds(nodes, nodeId)) {
      const existing = next.get(id);
      if (!existing) continue;
      next.set(id, {
        role,
        canCreateDocument: role === 'COLLABORATOR' ? existing.canCreateDocument : false,
      });
    }

    onChange(next);
  }

  function toggle(node: NodeView) {
    const next = new Map(value);
    const turningOn = !next.has(node.id);
    const descendants = collectDescendantIds(nodes, node.id);

    if (turningOn) {
      // Take the role of the nearest ticked ancestor, so a node added inside an
      // Admin branch does not silently land as a Viewer. Nothing above is
      // ticked -> Viewer, the least surprising starting point.
      const inherited: NodeAccessDraft = {
        role: nearestGrantedAncestorRole(nodes, next, node.id) ?? 'VIEWER',
        canCreateDocument: false,
      };

      next.set(node.id, inherited);
      // Convenience only: each of these can be changed or removed afterwards.
      for (const id of descendants) {
        if (!next.has(id)) next.set(id, { ...inherited });
      }
    } else {
      next.delete(node.id);
      for (const id of descendants) next.delete(id);
    }

    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari nama atau kode node…"
          aria-label="Cari node"
          className="pl-9"
        />
      </div>

      <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
        {tree.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {nodes.length === 0
              ? 'Belum ada node di hierarki.'
              : 'Tidak ada node yang cocok dengan pencarian.'}
          </p>
        ) : (
          <ul>
            {tree.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                depth={0}
                value={value}
                collapsed={collapsed}
                disabled={disabled}
                onToggleCollapse={(id) =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onToggle={toggle}
                onSetAccess={setAccess}
                onSetRole={setRoleCascading}
              />
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Mencentang sebuah node ikut mencentang semua node di bawahnya. Induk di atasnya tidak ikut,
        dan setiap node di bawah tetap bisa diubah atau dilepas satu per satu.
      </p>
    </div>
  );
}

/** The role held at the closest ticked ancestor, or null if there is none. */
function nearestGrantedAncestorRole(
  nodes: NodeView[],
  granted: Map<string, NodeAccessDraft>,
  nodeId: string,
): ProjectRole | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let parentId = byId.get(nodeId)?.parentId ?? null;

  while (parentId) {
    const access = granted.get(parentId);
    if (access) return access.role;
    parentId = byId.get(parentId)?.parentId ?? null;
  }

  return null;
}

function NodeRow({
  node,
  depth,
  value,
  collapsed,
  disabled,
  onToggleCollapse,
  onToggle,
  onSetAccess,
  onSetRole,
}: {
  node: TreeNode;
  depth: number;
  value: Map<string, NodeAccessDraft>;
  collapsed: Set<string>;
  disabled?: boolean;
  onToggleCollapse: (id: string) => void;
  onToggle: (node: NodeView) => void;
  onSetAccess: (nodeId: string, draft: NodeAccessDraft | null) => void;
  onSetRole: (nodeId: string, role: ProjectRole) => void;
}) {
  const access = value.get(node.id);
  const hasChildren = node.children.length > 0;
  const isOpen = !collapsed.has(node.id);

  return (
    <li>
      <div
        className={cn(
          'flex min-h-13 flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-1.5 last:border-0 dark:border-slate-800',
          access && 'bg-sky-50/60 dark:bg-sky-950/30',
        )}
        style={{ paddingInlineStart: `${Math.min(depth, 6) * 18 + 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleCollapse(node.id)}
            aria-expanded={isOpen}
            aria-label={isOpen ? `Tutup ${node.name}` : `Buka ${node.name}`}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
          >
            <ChevronRight
              className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden />
        )}

        <input
          type="checkbox"
          checked={Boolean(access)}
          disabled={disabled}
          onChange={() => onToggle(node)}
          aria-label={`Beri akses ke ${node.name}`}
          className="h-4 w-4 shrink-0 rounded border-slate-300 accent-sky-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-600"
        />

        <span className="min-w-0 flex-1 truncate text-sm text-slate-900 dark:text-slate-100">
          {node.name}
          <span className="ml-2 font-mono text-xs text-slate-400">{node.code}</span>
        </span>

        {/* The role sits on the row it belongs to, so "what am I here" is read
            in the same glance as "can I reach here". */}
        {access && (
          <div className="flex flex-wrap items-center gap-2">
            <SelectControl
              name={`role-${node.id}`}
              value={access.role}
              disabled={disabled}
              options={ROLE_OPTIONS}
              onValueChange={(next) => {
                if (!next) return;
                onSetRole(node.id, next as ProjectRole);
              }}
              className="h-8 w-40 text-xs"
            />

            {access.role === 'COLLABORATOR' && (
              <Checkbox
                checked={access.canCreateDocument}
                disabled={disabled}
                onChange={(event) =>
                  onSetAccess(node.id, {
                    role: access.role,
                    canCreateDocument: event.target.checked,
                  })
                }
                label="Boleh membuat dokumen"
                className="text-xs"
              />
            )}
          </div>
        )}
      </div>

      {hasChildren && isOpen && (
        <ul>
          {node.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              value={value}
              collapsed={collapsed}
              disabled={disabled}
              onToggleCollapse={onToggleCollapse}
              onToggle={onToggle}
              onSetAccess={onSetAccess}
              onSetRole={onSetRole}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
