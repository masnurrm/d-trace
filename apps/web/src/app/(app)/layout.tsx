import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type {
  AppSettingsView,
  DocumentTemplateSummary,
  SessionUser,
  WorkspaceTree,
} from '@dtrace/shared';
import { AppShell } from '@/components/layout/app-shell';
import { ApiUnreachable } from '@/components/layout/api-unreachable';
import { ApiRequestError, apiFetch, getSessionUser } from '@/lib/api/server';
import { getSettings } from '@/lib/api/settings';
import { apiBaseUrl } from '@/lib/config/env';

/**
 * The authentication boundary for every signed-in route.
 *
 * Middleware redirects unauthenticated visitors already; this second check is
 * not redundant. Middleware only sees cookies, whereas this asks the API who
 * the caller actually is - so a revoked or disabled account is caught here.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  let user: SessionUser | null;
  let settings: AppSettingsView;
  let tree: WorkspaceTree | null = null;
  let templates: DocumentTemplateSummary[] = [];

  try {
    user = await getSessionUser();
    settings = await getSettings();

    // The Workspace sidebar is the caller's own tree, so it is fetched with the
    // shell rather than by the page: the sidebar outlives every navigation
    // inside the Workspace, and fetching it per page would rebuild it each time.
    // Both calls tolerate failure — a sidebar that could not load is a sidebar
    // without contents, not a page that refuses to render.
    const [treeResult, templateResult] = await Promise.all([
      apiFetch<WorkspaceTree>('/workspace/tree').catch(() => null),
      apiFetch<DocumentTemplateSummary[]>('/document-templates?limit=100').catch(() => null),
    ]);
    tree = treeResult?.data ?? null;
    templates = templateResult?.data ?? [];
  } catch (error) {
    // The API being down is an operational state, not a rendering bug. Show
    // something that explains it rather than letting a `fetch failed` surface.
    if (error instanceof ApiRequestError && error.isUnreachable) {
      return <ApiUnreachable apiBaseUrl={apiBaseUrl} />;
    }
    throw error;
  }

  if (!user) redirect('/login');

  return (
    <AppShell user={user} settings={settings} tree={tree} templates={templates}>
      {children}
    </AppShell>
  );
}
