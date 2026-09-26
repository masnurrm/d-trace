'use client';

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Link2,
  Link2Off,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { edgeDirection, type FlowConfig, type FlowNode } from '@dtrace/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils/cn';
import { localId } from './section-defaults';

type Direction = 'up' | 'right' | 'down' | 'left';

const OFFSETS: Record<Direction, { row: number; col: number }> = {
  up: { row: -1, col: 0 },
  right: { row: 0, col: 1 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
};

const DIRECTION_LABELS: Record<Direction, string> = {
  up: 'Tambah node di atas',
  right: 'Tambah node di kanan',
  down: 'Tambah node di bawah',
  left: 'Tambah node di kiri',
};

/**
 * Normalises the grid back to origin after a node was added at a negative
 * coordinate (upwards or leftwards) or removed from an edge of the diagram.
 * Keeping the top-left at (0,0) is what lets the renderer size its grid from
 * the maximum row and column alone.
 */
function reseat(nodes: FlowNode[]): FlowNode[] {
  if (nodes.length === 0) return nodes;
  const minRow = Math.min(...nodes.map((node) => node.row));
  const minCol = Math.min(...nodes.map((node) => node.col));
  if (minRow === 0 && minCol === 0) return nodes;
  return nodes.map((node) => ({ ...node, row: node.row - minRow, col: node.col - minCol }));
}

export interface FlowEditorProps {
  open: boolean;
  onClose: () => void;
  config: FlowConfig;
  onChange: (config: FlowConfig) => void;
}

/**
 * The process-flow editor.
 *
 * The diagram is a grid, and the only way to grow it is to pick a node and add
 * a neighbour above, right, below or left of it. That constraint is what keeps
 * a flow drawn here printable: there is no free canvas to drift out of the
 * page margins, and every connector is either a clean orthogonal arrow or it
 * does not exist.
 */
export function FlowEditor({ open, onClose, config, onChange }: FlowEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(config.nodes[0]?.id ?? null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);

  const selected = config.nodes.find((node) => node.id === selectedId) ?? null;

  const bounds = useMemo(() => {
    if (config.nodes.length === 0) return { rows: 1, cols: 1 };
    return {
      rows: Math.max(...config.nodes.map((node) => node.row)) + 1,
      cols: Math.max(...config.nodes.map((node) => node.col)) + 1,
    };
  }, [config.nodes]);

  const occupied = useMemo(
    () => new Map(config.nodes.map((node) => [`${node.row}:${node.col}`, node.id])),
    [config.nodes],
  );

  function addNode(direction: Direction) {
    if (!selected) return;
    const offset = OFFSETS[direction];
    const row = selected.row + offset.row;
    const col = selected.col + offset.col;

    // The cell may already hold a node — then this is a request to connect the
    // two, not to create a third one on top of the existing one.
    const existingId = occupied.get(`${row}:${col}`);
    if (existingId) {
      connect(selected.id, existingId);
      return;
    }

    const node: FlowNode = {
      id: localId(),
      label: `Step ${config.nodes.length + 1}`,
      row,
      col,
      mode: 'FIXED',
    };

    onChange({
      ...config,
      nodes: reseat([...config.nodes, node]),
      edges: [...config.edges, { id: localId(), from: selected.id, to: node.id }],
    });
    setSelectedId(node.id);
  }

  function connect(from: string, to: string) {
    if (from === to) return;
    const exists = config.edges.some(
      (edge) =>
        (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from),
    );
    if (exists) return;
    onChange({ ...config, edges: [...config.edges, { id: localId(), from, to }] });
  }

  function updateNode(id: string, patch: Partial<FlowNode>) {
    onChange({
      ...config,
      nodes: config.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    });
  }

  function removeNode(id: string) {
    const nodes = reseat(config.nodes.filter((node) => node.id !== id));
    onChange({
      ...config,
      nodes,
      // An edge whose endpoint is gone is not a connection any more.
      edges: config.edges.filter((edge) => edge.from !== id && edge.to !== id),
    });
    setSelectedId(nodes[0]?.id ?? null);
  }

  function addRoot() {
    // A free cell on a new row, so a second chain never lands on an occupied one.
    const node: FlowNode = {
      id: localId(),
      label: `Step ${config.nodes.length + 1}`,
      row: config.nodes.length === 0 ? 0 : bounds.rows,
      col: 0,
      mode: 'FIXED',
    };
    onChange({ ...config, nodes: [...config.nodes, node] });
    setSelectedId(node.id);
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${bounds.cols}, minmax(96px, 1fr))`,
    gap: '10px',
  } as const;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Editor Process Flow"
      description="Pilih satu node, lalu tambahkan node di atas, kanan, bawah, atau kiri. Panah dibuat otomatis."
      footer={<Button onClick={onClose}>Selesai</Button>}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            {config.nodes.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Belum ada node. Tambahkan node pertama di panel kanan.
              </p>
            ) : (
              <div style={gridStyle}>
                {config.nodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    style={{ gridColumn: node.col + 1, gridRow: node.row + 1 }}
                    onClick={() => {
                      if (linkFrom && linkFrom !== node.id) {
                        connect(linkFrom, node.id);
                        setLinkFrom(null);
                        return;
                      }
                      setSelectedId(node.id);
                    }}
                    className={cn(
                      'rounded-lg border px-2 py-2 text-xs font-semibold transition-colors',
                      node.mode === 'FIXED'
                        ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200'
                        : 'border-dashed border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900',
                      node.id === selectedId && 'outline-2 outline-offset-2 outline-sky-600',
                      linkFrom === node.id && 'outline-2 outline-offset-2 outline-amber-500',
                    )}
                  >
                    {node.label || '(tanpa label)'}
                    <span className="mt-1 block text-[10px] font-normal text-slate-400">
                      b{node.row + 1} · k{node.col + 1}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {linkFrom && (
            <Alert tone="warning" title="Mode sambung">
              Klik node tujuan untuk membuat panah, atau batalkan di panel kanan.
            </Alert>
          )}

          <div className="rounded-lg border border-slate-200 dark:border-slate-800">
            <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300">
              Panah ({config.edges.length})
            </p>
            {config.edges.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-500">Belum ada panah.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {config.edges.map((edge) => {
                  const from = config.nodes.find((node) => node.id === edge.from);
                  const to = config.nodes.find((node) => node.id === edge.to);
                  const adjacent = from && to ? edgeDirection(from, to) : null;

                  return (
                    <li
                      key={edge.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <span className="truncate">
                        {from?.label || '?'} → {to?.label || '?'}
                        {!adjacent && (
                          // Kept, but the renderer has no gap track to draw it
                          // in; saying so beats a connection that silently
                          // vanishes from the printed page.
                          <span className="ml-2 text-amber-600">
                            tidak bersebelahan, panah tidak tergambar
                          </span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Hapus panah"
                        onClick={() =>
                          onChange({
                            ...config,
                            edges: config.edges.filter((item) => item.id !== edge.id),
                          })
                        }
                      >
                        <Link2Off className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <Button block variant="outline" onClick={addRoot}>
            + Node lepas
          </Button>

          {selected ? (
            <>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Tambah dari node terpilih
                </p>
                <div className="mx-auto grid w-[168px] grid-cols-3 grid-rows-3 gap-1">
                  <div />
                  <DirectionButton direction="up" onClick={addNode} Icon={ArrowUp} />
                  <div />
                  <DirectionButton direction="left" onClick={addNode} Icon={ArrowLeft} />
                  <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-[10px] text-slate-400 dark:border-slate-700">
                    node
                  </div>
                  <DirectionButton direction="right" onClick={addNode} Icon={ArrowRight} />
                  <div />
                  <DirectionButton direction="down" onClick={addNode} Icon={ArrowDown} />
                  <div />
                </div>
              </div>

              <TextField
                label="Label node"
                value={selected.label}
                maxLength={60}
                onChange={(event) => updateNode(selected.id, { label: event.target.value })}
              />

              <SelectField
                label="Isi node"
                value={selected.mode}
                options={[
                  { value: 'FIXED', label: 'Tetap dari template' },
                  { value: 'INPUT', label: 'Dikosongkan untuk user' },
                ]}
                onValueChange={(value) =>
                  updateNode(selected.id, { mode: value as FlowNode['mode'] })
                }
              />

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  leftIcon={<Link2 className="h-4 w-4" aria-hidden />}
                  onClick={() => setLinkFrom(linkFrom ? null : selected.id)}
                >
                  {linkFrom ? 'Batal' : 'Sambung'}
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  aria-label="Hapus node"
                  onClick={() => removeNode(selected.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">Pilih salah satu node untuk mengubahnya.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function DirectionButton({
  direction,
  onClick,
  Icon,
}: {
  direction: Direction;
  onClick: (direction: Direction) => void;
  Icon: typeof ArrowUp;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      className="h-full w-full"
      aria-label={DIRECTION_LABELS[direction]}
      title={DIRECTION_LABELS[direction]}
      onClick={() => onClick(direction)}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </Button>
  );
}
