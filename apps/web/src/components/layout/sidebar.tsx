'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Box, LifeBuoy, PanelLeft, X } from 'lucide-react';
import type {
  DocumentTemplateSummary,
  Role,
  SessionUser,
  WorkspaceNode,
  WorkspaceProjectSummary,
  WorkspaceTree,
} from '@dtrace/shared';
import { availableModes, findNavItem, modeForPath, visibleNavGroups } from './navigation';
import { ModeSwitcher } from './mode-switcher';
import { WorkspaceNav } from './workspace-nav';
import {
  CreateDocumentDialog,
  CreateProjectDialog,
} from '@/components/workspace/create-dialogs';
import { UserCard } from './user-card';
import { useWorkspaceTree } from '@/lib/query/use-workspace-tree';
import { cn } from '@/lib/utils/cn';

interface SidebarProps {
  user: SessionUser;
  appName: string;
  tagline: string | null;
  /**
   * The caller's own nodes, projects and documents, as the server rendered
   * them. Null outside the Workspace. It seeds the query that owns the tree
   * from here on, so creating a project updates the sidebar without a reload.
   */
  tree: WorkspaceTree | null;
  /** Active master templates, offered when a document is created. */
  templates: DocumentTemplateSummary[];
  /** Controlled by the shell so the header toggle can reach it on small screens. */
  open: boolean;
  onClose: () => void;
}

/**
 * The primary navigation. A client component because it highlights the current
 * route and owns the mobile open/closed state.
 *
 * On screens below `lg` it is a drawer over the content; from `lg` up it is a
 * permanent column, so the same markup serves both without a second component.
 */
export function Sidebar({
  user,
  appName,
  tagline,
  tree: initialTree,
  templates,
  open,
  onClose,
}: SidebarProps) {
  const tree = useWorkspaceTree(initialTree);
  const pathname = usePathname();
  const role = user.role as Role;
  // The mode comes from the URL, so the sidebar can never disagree with the
  // page it is standing next to.
  const mode = modeForPath(pathname);
  const groups = visibleNavGroups(role, mode);
  // Exactly one link is current. Matching on a prefix alone would light up
  // Beranda (`/workspace`) as well as Project (`/workspace/project`), so the
  // longest matching href wins instead.
  const activeHref = findNavItem(pathname)?.href;

  // The create dialogs are owned here because both the node row and the project
  // row can open them, and they must survive the tree re-rendering underneath.
  const [projectDialogNode, setProjectDialogNode] = useState<WorkspaceNode | null>(null);
  const [documentDialogProject, setDocumentDialogProject] =
    useState<WorkspaceProjectSummary | null>(null);

  // Navigating on a phone should dismiss the drawer; leaving it open would
  // cover the page the user just asked for.
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  // Escape closes it, which is what a drawer is expected to do.
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
        />
      )}

      <aside
        id="sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-slate-900 text-slate-300 transition-transform duration-200 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-start gap-3 px-5 py-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-white">
            <Box className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-white">{appName}</p>
            {tagline && <p className="truncate text-xs text-slate-400">{tagline}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup menu"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <ModeSwitcher current={mode} available={availableModes(role)} />

        {/*
          `min-h-0` is what keeps the two modes the same shape. Workspace has
          three links and the Admin Panel has eight; without it the flex child
          refuses to shrink below its content, the list pushes the help card and
          the account block off the bottom, and switching modes makes the whole
          sidebar jump. With it, this region absorbs the difference and scrolls,
          so everything above and below stays exactly where it was.
        */}
        {mode === 'workspace' && tree ? (
          <WorkspaceNav
            tree={tree}
            onCreateProject={setProjectDialogNode}
            onCreateDocument={(node, project) => {
              // The node travels with the project so the dialog can name where
              // the document is going without looking it up again.
              setProjectDialogNode(null);
              setDocumentDialogProject(project);
            }}
          />
        ) : (
        <nav
          aria-label="Navigasi utama"
          className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-4"
        >
          {groups.map((group) => (
            <div key={group.label ?? 'root'} className="space-y-1">
              {group.label && (
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const isActive = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-slate-800 font-medium text-white'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
                    )}
                  >
                    <item.Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.comingSoon && (
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 ring-1 ring-inset ring-slate-700">
                        Segera
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        )}

        <div className="space-y-3 px-3 pb-4">
          <div className="rounded-lg bg-slate-800/60 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium text-white">
              <LifeBuoy className="h-4 w-4" aria-hidden />
              Butuh bantuan?
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Buka{' '}
              <Link href="/bantuan" className="underline underline-offset-2 hover:text-slate-200">
                dokumentasi internal
              </Link>{' '}
              D-Trace.
            </p>
          </div>

          <UserCard user={user} />
        </div>
      </aside>

      <CreateProjectDialog node={projectDialogNode} onClose={() => setProjectDialogNode(null)} />
      <CreateDocumentDialog
        project={documentDialogProject}
        templates={templates}
        onClose={() => setDocumentDialogProject(null)}
      />
    </>
  );
}

/** The header button that opens the drawer; hidden once the sidebar is permanent. */
export function SidebarToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Buka menu"
      aria-controls="sidebar"
      className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      <PanelLeft className="h-5 w-5" aria-hidden />
    </button>
  );
}

