'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Info,
  LayoutList,
  ListTree,
  Plus,
  Power,
  Search,
} from 'lucide-react';
import {
  buildTree,
  collectDescendantIds,
  computeStats,
  type NodeTypeView,
  type NodeView,
  type TreeNode,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils/cn';
import { EmptyTree, NodeTree, type NodeAction } from './node-tree';
import { NodeDialog, type NodeDialogMode } from './node-dialog';
import { MoveNodeDialog } from './move-node-dialog';

type SortKey = 'name-asc' | 'name-desc' | 'newest' | 'type';

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Nama (A–Z)' },
  { value: 'name-desc', label: 'Nama (Z–A)' },
  { value: 'newest', label: 'Terbaru' },
  { value: 'type', label: 'Jenis node' },
];

interface HierarchyExplorerProps {
  initialNodes: NodeView[];
  initialTypes: NodeTypeView[];
  canEdit: boolean;
}

/**
 * The Hierarki screen.
 *
 * The whole tree arrives in one payload, so searching, expanding, filtering and
 * selecting are local and instant; only mutations go back to the server, and
 * each one invalidates the single `nodes` query rather than patching state by
 * hand. That is what keeps the screen honest after a rule rejects a change.
 */
export function HierarchyExplorer({
  initialNodes,
  initialTypes,
  canEdit,
}: HierarchyExplorerProps) {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('name-asc');
  const [view, setView] = useState<'tree' | 'list'>('tree');
  const [showInactive, setShowInactive] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [nodeDialog, setNodeDialog] = useState<NodeDialogMode | null>(null);
  const [moving, setMoving] = useState<NodeView | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NodeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: nodes = [] } = useQuery({
    queryKey: ['nodes', { includeInactive: true }],
    queryFn: async () =>
      (await clientFetch<NodeView[]>('/nodes', { searchParams: { includeInactive: 'true' } })).data,
    initialData: initialNodes,
  });

  const { data: types = [] } = useQuery({
    queryKey: ['node-types', { includeInactive: true }],
    queryFn: async () =>
      (await clientFetch<NodeTypeView[]>('/node-types', { searchParams: { includeInactive: 'true' } }))
        .data,
    initialData: initialTypes,
  });

  const setActivation = useMutation({
    mutationFn: (variables: { ids: string[]; isActive: boolean }) =>
      clientFetch<{ affected: number }>('/nodes/activation', { method: 'POST', body: variables }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      setSelected(new Set());
      setError(null);
    },
    onError: (caught) =>
      setError(caught instanceof ApiClientError ? caught.message : 'Gagal mengubah status node.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => clientFetch<void>(`/nodes/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      setPendingDelete(null);
      setError(null);
    },
    onError: (caught) => {
      setError(caught instanceof ApiClientError ? caught.message : 'Gagal menghapus node.');
      setPendingDelete(null);
    },
  });

  const visibleNodes = useMemo(() => {
    const query = search.trim().toLowerCase();

    return nodes.filter((node) => {
      if (!showInactive && !node.isActive) return false;
      if (typeFilter && node.type.id !== typeFilter) return false;
      if (!query) return true;
      return (
        node.name.toLowerCase().includes(query) || node.code.toLowerCase().includes(query)
      );
    });
  }, [nodes, search, typeFilter, showInactive]);

  /**
   * A filtered tree keeps ancestors of every match, otherwise a deep hit would
   * vanish with its parent and the result would look like "not found".
   */
  const tree = useMemo(() => {
    const isFiltering = search.trim() !== '' || typeFilter !== '';
    if (!isFiltering) return sortTree(buildTree(visibleNodes), sort);

    const keep = new Set<string>();
    const byId = new Map(nodes.map((node) => [node.id, node]));

    for (const match of visibleNodes) {
      keep.add(match.id);
      let parentId = match.parentId;
      while (parentId) {
        if (keep.has(parentId)) break;
        keep.add(parentId);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
    }

    const kept = nodes.filter((node) => keep.has(node.id) && (showInactive || node.isActive));
    return sortTree(buildTree(kept), sort);
  }, [nodes, visibleNodes, search, typeFilter, showInactive, sort]);

  const stats = useMemo(() => computeStats(nodes), [nodes]);
  const isFiltering = search.trim() !== '' || typeFilter !== '';
  const flatList = view === 'list';

  function expandAll() {
    setExpanded(new Set(nodes.filter((node) => node.childCount > 0).map((node) => node.id)));
  }

  function handleAction(action: NodeAction, node: NodeView) {
    setError(null);

    switch (action) {
      case 'add-child':
        setNodeDialog({ kind: 'create', parent: node });
        break;
      case 'rename':
        setNodeDialog({ kind: 'edit', node });
        break;
      case 'move':
        setMoving(node);
        break;
      case 'toggle-active':
        setActivation.mutate({
          ids: node.isActive ? [node.id] : withInactiveBranch(nodes, [node.id]),
          isActive: !node.isActive,
        });
        break;
      case 'delete':
        setPendingDelete(node);
        break;
    }
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedNodes = nodes.filter((node) => selected.has(node.id));
  const descendantsOfSelection = selectedNodes.flatMap((node) =>
    collectDescendantIds(nodes, node.id),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hierarki Organisasi"
        description="Susun node tempat project menempel. Hierarki ini menentukan siapa melihat project apa."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={expandAll}
              leftIcon={<ChevronsUpDown className="h-4 w-4" aria-hidden />}
            >
              Buka Semua
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(new Set())}
              leftIcon={<ChevronsDownUp className="h-4 w-4" aria-hidden />}
            >
              Tutup Semua
            </Button>
            {canEdit && (
              <Button
                size="sm"
                onClick={() => setNodeDialog({ kind: 'create', parent: null })}
                leftIcon={<Plus className="h-4 w-4" aria-hidden />}
              >
                Tambah Node Akar
              </Button>
            )}
          </div>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
            <TextField
              label="Cari"
              name="node-search"
              placeholder="Cari nama atau kode node…"
              value={search}
              leadingIcon={<Search className="h-4 w-4" aria-hidden />}
              onChange={(event) => setSearch(event.target.value)}
            />
            <SelectField
              label="Jenis"
              name="node-type-filter"
              placeholder="Semua jenis"
              value={typeFilter}
              onValueChange={(value) => setTypeFilter(value)}
              options={types.map((type) => ({ value: type.id, label: type.name }))}
            />
            <SelectField
              label="Urutkan"
              name="node-sort"
              value={sort}
              onValueChange={(value) => setSort(value as SortKey)}
              options={SORT_OPTIONS}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Switch
              checked={showInactive}
              onChange={setShowInactive}
              label="Tampilkan node nonaktif"
            />

            <div
              role="group"
              aria-label="Tampilan"
              className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
            >
              {(
                [
                  { id: 'tree', label: 'Pohon', Icon: ListTree },
                  { id: 'list', label: 'Daftar', Icon: LayoutList },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={view === option.id}
                  onClick={() => setView(option.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    view === option.id
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
                  )}
                >
                  <option.Icon className="h-4 w-4" aria-hidden />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {canEdit && selected.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-900 dark:bg-sky-950">
              <p className="text-sm text-sky-900 dark:text-sky-100">
                <strong>{selected.size}</strong> node dipilih
                {descendantsOfSelection.length > 0 && (
                  <span className="text-sky-700 dark:text-sky-300">
                    {' '}
                    · menonaktifkan ikut memengaruhi {descendantsOfSelection.length} node di
                    bawahnya
                  </span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  loading={setActivation.isPending}
                  onClick={() =>
                    setActivation.mutate({
                      ids: withInactiveBranch(nodes, [...selected]),
                      isActive: true,
                    })
                  }
                  leftIcon={<Power className="h-4 w-4" aria-hidden />}
                >
                  Aktifkan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={setActivation.isPending}
                  onClick={() =>
                    setActivation.mutate({ ids: [...selected], isActive: false })
                  }
                  leftIcon={<Power className="h-4 w-4" aria-hidden />}
                >
                  Nonaktifkan
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Bersihkan
                </Button>
              </div>
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {isFiltering ? `${visibleNodes.length} cocok` : `${stats.total} node`}
              </p>
              {canEdit && nodes.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelected((current) =>
                      current.size === visibleNodes.length
                        ? new Set()
                        : new Set(visibleNodes.map((node) => node.id)),
                    )
                  }
                  className="text-sm font-medium text-sky-600 hover:underline"
                >
                  {selected.size === visibleNodes.length && visibleNodes.length > 0
                    ? 'Bersihkan pilihan'
                    : 'Pilih semua'}
                </button>
              )}
            </div>

            {tree.length === 0 ? (
              <EmptyTree filtered={isFiltering} />
            ) : (
              <NodeTree
                tree={flatList ? flatten(tree) : tree}
                expanded={expanded}
                selected={selected}
                onToggleExpand={(id) =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onToggleSelect={toggleSelect}
                onAction={handleAction}
                canEdit={canEdit}
                flat={flatList}
              />
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Statistik Hierarki
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-3">
              {[
                { label: 'Total node', value: stats.total },
                { label: 'Node akar', value: stats.roots },
                { label: 'Node anak', value: stats.children },
                { label: 'Node aktif', value: stats.active },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800"
                >
                  <dd className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                    {item.value}
                  </dd>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">{item.label}</dt>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Info className="h-4 w-4 text-slate-400" aria-hidden />
              Tips
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Centang beberapa node untuk mengaktifkan atau menonaktifkannya sekaligus.
              Menonaktifkan sebuah node ikut menonaktifkan seluruh cabang di bawahnya.
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Node hanya bisa diletakkan di tempat yang diizinkan{' '}
              <strong className="font-medium">Jenis Node</strong>-nya.
            </p>
          </Card>
        </aside>
      </div>

      <NodeDialog
        mode={nodeDialog}
        onClose={() => setNodeDialog(null)}
        types={types}
        nodes={nodes}
      />

      <MoveNodeDialog
        node={moving}
        onClose={() => setMoving(null)}
        nodes={nodes}
        types={types}
      />

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Hapus node?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
            >
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {pendingDelete?.name}
          </span>{' '}
          akan dihapus permanen. Tindakan ini tercatat di Audit Log.
        </p>
      </Dialog>
    </div>
  );
}

function sortTree(tree: TreeNode[], sort: SortKey): TreeNode[] {
  const compare = (a: TreeNode, b: TreeNode) => {
    switch (sort) {
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'newest':
        return b.createdAt.localeCompare(a.createdAt);
      case 'type':
        return a.type.name.localeCompare(b.type.name) || a.name.localeCompare(b.name);
      default:
        return a.name.localeCompare(b.name);
    }
  };

  const walk = (list: TreeNode[]): TreeNode[] =>
    [...list].sort(compare).map((node) => ({ ...node, children: walk(node.children) }));

  return walk(tree);
}

/**
 * A selection plus every currently-inactive node beneath it.
 *
 * Reactivating a branch one node at a time is busywork, and the API refuses a
 * child whose parent is still inactive — so the UI sends the whole branch in
 * one call. Nodes that are already active are left out, so this never disturbs
 * anything the operator did not ask about.
 */
function withInactiveBranch(nodes: NodeView[], ids: string[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result = new Set(ids);

  for (const id of ids) {
    for (const descendant of collectDescendantIds(nodes, id)) {
      if (byId.get(descendant)?.isActive === false) result.add(descendant);
    }
  }

  return [...result];
}

/** List view: every node at one level, order preserved from the sorted tree. */
function flatten(tree: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      result.push({ ...node, children: [] });
      walk(node.children);
    }
  };
  walk(tree);
  return result;
}
