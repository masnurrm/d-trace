import type { ReactNode } from 'react';
import type {
  AppSettingsView,
  DocumentTemplateSummary,
  SessionUser,
  WorkspaceTree,
} from '@dtrace/shared';
import { ShellChrome } from './shell-chrome';

/**
 * Server-side entry to the application chrome. It exists so the settings and
 * the session are fetched during render - the first paint already knows the
 * app name, the marquee and the footer, with no client round trip.
 */
export function AppShell({
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
  return (
    <ShellChrome user={user} settings={settings} tree={tree} templates={templates}>
      {children}
    </ShellChrome>
  );
}
