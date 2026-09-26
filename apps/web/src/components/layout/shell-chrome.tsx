'use client';

import { useCallback, useState, type ReactNode } from 'react';
import type {
  AppSettingsView,
  DocumentTemplateSummary,
  SessionUser,
  WorkspaceTree,
} from '@dtrace/shared';
import { Sidebar, SidebarToggle } from './sidebar';
import { BreadcrumbProvider } from './breadcrumb-context';
import { Breadcrumbs } from './breadcrumbs';
import { UserMenu } from './user-menu';
import { MarqueeBar } from './marquee-bar';
import { NotificationBell } from './notification-bell';
import { cn } from '@/lib/utils/cn';

const FOOTER_ALIGNMENT_CLASSES = {
  LEFT: 'justify-start text-left',
  CENTER: 'justify-center text-center',
  RIGHT: 'justify-end text-right',
} as const;

/**
 * Everything around the page: sidebar, header, marquee and footer.
 *
 * It is one client component rather than several because the drawer state has
 * to be shared between the header toggle and the sidebar itself. `children`
 * stays server-rendered — React streams it through untouched.
 */
export function ShellChrome({
  user,
  settings,
  tree,
  templates,
  children,
}: {
  user: SessionUser;
  settings: AppSettingsView;
  tree: WorkspaceTree | null;
  templates: DocumentTemplateSummary[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Stable identities: the sidebar closes itself on navigation via an effect,
  // and a callback recreated each render would re-fire it constantly.
  const close = useCallback(() => setOpen(false), []);
  const openDrawer = useCallback(() => setOpen(true), []);

  const { identity, marquee, footer } = settings;

  const footerParts = [
    footer.showAppName ? identity.appName : null,
    footer.text,
    footer.showVersion ? `v${identity.version}` : null,
  ].filter((part): part is string => Boolean(part));

  return (
    // Above both the header and the page, so a page can publish the trail the
    // header draws.
    <BreadcrumbProvider>
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar
        user={user}
        appName={identity.appName}
        tagline={identity.tagline}
        tree={tree}
        templates={templates}
        open={open}
        onClose={close}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <SidebarToggle onOpen={openDrawer} />
            <Breadcrumbs appName={identity.appName} />

            <div className="ml-auto flex items-center gap-3">
              <NotificationBell />

              <UserMenu user={user} />
            </div>
          </div>

          {marquee.enabled && (
            <MarqueeBar items={marquee.items} speedSeconds={marquee.speedSeconds} />
          )}
        </header>

        {/*
          No max-width: the sidebar already bounds the reading column, and a
          second cap on top of it just left the tables floating in whitespace
          on a wide screen. The gutter grows with the viewport instead.
        */}
        <main className="w-full min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>

        {footerParts.length > 0 && (
          <footer className="border-t border-slate-200 px-4 py-4 sm:px-6 lg:px-8 dark:border-slate-800">
            <div
              className={cn(
                'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400',
                FOOTER_ALIGNMENT_CLASSES[footer.align],
              )}
            >
              {footerParts.map((part, index) => (
                <span key={part} className="flex items-center gap-2">
                  {index > 0 && <span aria-hidden>·</span>}
                  {part}
                </span>
              ))}
            </div>
          </footer>
        )}
      </div>
    </div>
    </BreadcrumbProvider>
  );
}
