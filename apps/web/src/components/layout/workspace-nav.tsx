'use client';

import {
  Boxes,
  ChevronRight,
  Clock,
  FileText,
  FolderClosed,
  FolderOpen,
  Home,
  Plus,
  Search,
  Star,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { WorkspaceNode, WorkspaceProjectSummary, WorkspaceTree } from '@dtrace/shared';
import { cn } from '@/lib/utils/cn';
import { dynamicRoute } from '@/lib/utils/routes';

const FIXED_LINKS: { href: Route; label: string; Icon: LucideIcon }[] = [
  { href: '/workspace', label: 'Beranda', Icon: Home },
  { href: '/workspace/terbaru', label: 'Terbaru', Icon: Clock },
  { href: '/workspace/favorit', label: 'Favorit', Icon: Star },
];

export interface WorkspaceNavProps {
  tree: WorkspaceTree;
  /** Opens the "new project" dialog for a node the caller may create in. */
  onCreateProject: (node: WorkspaceNode) => void;
  /** Opens the "new document" dialog inside a project. */
  onCreateDocument: (node: WorkspaceNode, project: WorkspaceProjectSummary) => void;
}

/**
 * The Workspace half of the sidebar.
 *
 * Three fixed entries, then the contents: every node this account can reach,
 * the projects inside it, and the documents inside those. The tree is the
 * caller's own access rendered literally — a node absent here is a node they
 * have no grant on, not a node that is merely hidden — so the "+" next to one
 * appears exactly when the API would accept the create.
 */
export function WorkspaceNav({ tree, onCreateProject, onCreateDocument }: WorkspaceNavProps) {
  const pathname = usePathname();
  const [search, setSearch] = useState('');
  // What has been opened, not what has been folded: the tree starts closed, so
  // a reader with many nodes sees the list of nodes rather than all of it at once.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const query = search.trim().toLowerCase();

  // Searching filters documents and projects but keeps the node that holds a
  // match, so a hit never appears without the context that explains where it is.
  const nodes = useMemo(() => {
    if (!query) return tree.nodes;

    return tree.nodes
      .map((node) => {
        const projects = node.projects
          .map((project) => {
            const documents = project.documents.filter((document) =>
              document.title.toLowerCase().includes(query),
            );
            const projectMatches = project.name.toLowerCase().includes(query);
            if (!projectMatches && documents.length === 0) return null;
            return { ...project, documents: projectMatches ? project.documents : documents };
          })
          .filter((project): project is WorkspaceProjectSummary => project !== null);

        if (projects.length === 0 && !node.name.toLowerCase().includes(query)) return null;
        return { ...node, projects };
      })
      .filter((node): node is WorkspaceNode => node !== null);
  }, [tree.nodes, query]);

  // A search result that stayed folded would be invisible, so a live query
  // overrides whatever the operator had left closed.
  const isOpen = (key: string) => (query ? true : Boolean(expanded[key]));
  const toggle = (key: string) =>
    setExpanded((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Navigasi workspace" className="space-y-1 px-3">
        {FIXED_LINKS.map((link) => {
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-slate-800 font-medium text-white'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
              )}
            >
              <link.Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1 truncate">{link.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pt-5 pb-2">
        <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Isi
        </p>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            aria-hidden
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari judul"
            aria-label="Cari project atau dokumen"
            className="w-full rounded-lg border border-slate-700/60 bg-slate-800/40 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-2 focus:outline-offset-0 focus:outline-sky-500"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {nodes.length === 0 && (
          <p className="px-3 py-4 text-xs text-slate-500">
            {query
              ? 'Tidak ada yang cocok dengan pencarian ini.'
              : 'Belum ada node yang ditugaskan ke akun Anda.'}
          </p>
        )}

        {nodes.map((node) => (
          <div key={node.id}>
            <div className="group flex items-center gap-1 rounded-lg pr-1 hover:bg-slate-800/40">
              <button
                type="button"
                onClick={() => toggle(node.id)}
                aria-expanded={isOpen(node.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-slate-100"
              >
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform',
                    isOpen(node.id) && 'rotate-90',
                  )}
                  aria-hidden
                />
                <Boxes className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{node.name}</span>
                  {/* Only Apps are listed, so the department above is what
                      tells two similarly named ones apart. The App itself is
                      dropped from the path — it is the line above. */}
                  {node.path.length > 1 && (
                    <span className="block truncate text-[10px] font-normal text-slate-500">
                      {node.path.slice(-2, -1).join(' / ')}
                    </span>
                  )}
                </span>
              </button>

              {node.capabilities.createProject && (
                <button
                  type="button"
                  onClick={() => onCreateProject(node)}
                  aria-label={`Tambah project di ${node.name}`}
                  title={`Tambah project di ${node.name}`}
                  className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-700 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>

            {isOpen(node.id) && (
              <div className="ml-3 border-l border-slate-800 pl-1">
                {node.projects.length === 0 && (
                  <p className="px-4 py-1.5 text-xs text-slate-500">Belum ada project.</p>
                )}

                {node.projects.map((project) => {
                  const key = `${node.id}:${project.id}`;
                  const open = isOpen(key);
                  const href = dynamicRoute(`/workspace/project/${project.id}`);
                  const isActive = pathname === href;

                  return (
                    <div key={project.id}>
                      <div
                        className={cn(
                          'group flex items-center gap-1 rounded-lg pr-1',
                          isActive ? 'bg-slate-800' : 'hover:bg-slate-800/40',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          aria-expanded={open}
                          aria-label={open ? `Tutup ${project.name}` : `Buka ${project.name}`}
                          className="rounded p-1 text-slate-500 hover:text-white"
                        >
                          <ChevronRight
                            className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')}
                            aria-hidden
                          />
                        </button>

                        <Link
                          href={href}
                          aria-current={isActive ? 'page' : undefined}
                          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm text-slate-300 hover:text-white"
                        >
                          {open ? (
                            <FolderOpen className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                          ) : (
                            <FolderClosed className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                          )}
                          <span className="truncate">{project.name}</span>
                        </Link>

                        {node.capabilities.createDocument && (
                          <button
                            type="button"
                            onClick={() => onCreateDocument(node, project)}
                            aria-label={`Tambah dokumen di ${project.name}`}
                            title={`Tambah dokumen di ${project.name}`}
                            className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-700 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <Plus className="h-4 w-4" aria-hidden />
                          </button>
                        )}
                      </div>

                      {open && (
                        <div className="ml-6 border-l border-slate-800 pl-2">
                          {project.documents.length === 0 ? (
                            <p className="px-2 py-1.5 text-xs text-slate-500">
                              Belum ada dokumen.
                            </p>
                          ) : (
                            project.documents.map((document) => {
                              const documentHref = dynamicRoute(
                                `/workspace/dokumen/${document.id}`,
                              );
                              return (
                                <Link
                                  key={document.id}
                                  href={documentHref}
                                  aria-current={pathname === documentHref ? 'page' : undefined}
                                  className={cn(
                                    'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                                    pathname === documentHref
                                      ? 'bg-slate-800 text-white'
                                      : 'text-slate-400 hover:bg-slate-800/40 hover:text-white',
                                  )}
                                >
                                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  <span className="truncate">{document.title}</span>
                                  {document.isFavorite && (
                                    <Star
                                      className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400"
                                      aria-label="Favorit"
                                    />
                                  )}
                                </Link>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
