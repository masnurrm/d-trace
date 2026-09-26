'use client';

import { ChevronRight, Building2, Move, Pencil, Plus, Power, Tag, Trash2 } from 'lucide-react';
import type { NodeView, TreeNode } from '@dtrace/shared';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils/cn';

export type NodeAction = 'add-child' | 'rename' | 'move' | 'toggle-active' | 'delete';

interface NodeTreeProps {
  tree: TreeNode[];
  expanded: Set<string>;
  selected: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onAction: (action: NodeAction, node: NodeView) => void;
  canEdit: boolean;
  /** List view drops the nesting and shows every match at one level. */
  flat?: boolean;
}

/** Indentation is capped so a deep branch never pushes the name off a phone. */
const INDENT_PX = 20;
const MAX_INDENT_STEPS = 6;

export function NodeTree({
  tree,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
  onAction,
  canEdit,
  flat = false,
}: NodeTreeProps) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {tree.map((node) => (
        <NodeBranch
          key={node.id}
          node={node}
          expanded={expanded}
          selected={selected}
          onToggleExpand={onToggleExpand}
          onToggleSelect={onToggleSelect}
          onAction={onAction}
          canEdit={canEdit}
          flat={flat}
        />
      ))}
    </ul>
  );
}

function NodeBranch({
  node,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
  onAction,
  canEdit,
  flat,
}: Omit<NodeTreeProps, 'tree'> & { node: TreeNode }) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const indent = flat ? 0 : Math.min(node.depth, MAX_INDENT_STEPS) * INDENT_PX;

  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2.5 transition-colors sm:px-4',
          selected.has(node.id)
            ? 'bg-sky-50 dark:bg-sky-950/40'
            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
          !node.isActive && 'opacity-60',
        )}
        style={{ paddingInlineStart: `${indent + 12}px` }}
      >
        {hasChildren && !flat ? (
          <button
            type="button"
            onClick={() => onToggleExpand(node.id)}
            aria-expanded={isOpen}
            aria-label={isOpen ? `Tutup ${node.name}` : `Buka ${node.name}`}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <ChevronRight
              className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}

        {canEdit && (
          <input
            type="checkbox"
            checked={selected.has(node.id)}
            onChange={() => onToggleSelect(node.id)}
            aria-label={`Pilih ${node.name}`}
            className="h-4 w-4 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
        )}

        <Building2 className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" aria-hidden />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {node.name}
          </p>
          <p className="truncate font-mono text-xs text-slate-400">{node.code}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* The type is the most useful label, so it survives on small screens;
              the rest drops away rather than wrapping into a second line. */}
          <Badge>{node.type.name}</Badge>
          {hasChildren && (
            <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
              {node.children.length} anak
            </span>
          )}
          {!node.isActive && <Badge tone="warning">Nonaktif</Badge>}

          {canEdit && (
            <DropdownMenu
              label={`Aksi untuk ${node.name}`}
              actions={[
                {
                  label: 'Tambah Anak',
                  icon: <Plus className="h-4 w-4" aria-hidden />,
                  onSelect: () => onAction('add-child', node),
                },
                {
                  label: 'Ubah Nama / Jenis',
                  icon: <Pencil className="h-4 w-4" aria-hidden />,
                  onSelect: () => onAction('rename', node),
                },
                {
                  label: 'Pindahkan',
                  icon: <Move className="h-4 w-4" aria-hidden />,
                  onSelect: () => onAction('move', node),
                },
                {
                  label: node.isActive ? 'Nonaktifkan' : 'Aktifkan',
                  icon: <Power className="h-4 w-4" aria-hidden />,
                  onSelect: () => onAction('toggle-active', node),
                },
                {
                  label: 'Hapus Node',
                  icon: <Trash2 className="h-4 w-4" aria-hidden />,
                  danger: true,
                  disabled: hasChildren,
                  onSelect: () => onAction('delete', node),
                },
              ]}
            />
          )}
        </div>
      </div>

      {hasChildren && isOpen && !flat && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {node.children.map((child) => (
            <NodeBranch
              key={child.id}
              node={child}
              expanded={expanded}
              selected={selected}
              onToggleExpand={onToggleExpand}
              onToggleSelect={onToggleSelect}
              onAction={onAction}
              canEdit={canEdit}
              flat={flat}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Empty state for the tree card, kept next to the thing it replaces. */
export function EmptyTree({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
      <span className="rounded-full bg-slate-100 p-3 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <Tag className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
        {filtered ? 'Tidak ada node yang cocok' : 'Hierarki masih kosong'}
      </p>
      <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
        {filtered
          ? 'Ubah kata kunci atau filter untuk melihat node lain.'
          : 'Mulai dengan menambahkan node akar, lalu susun cabang di bawahnya.'}
      </p>
    </div>
  );
}
