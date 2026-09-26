import type { Metadata } from 'next';
import { ProjectDashboard } from '@/components/workspace/dashboard/project-dashboard';

export const metadata: Metadata = { title: 'Workspace' };

/**
 * The landing page of the Workspace: one project's progress from development,
 * through testing, to the SIT/UAT result.
 *
 * The dashboard is a client component because its two filters and its "last
 * opened project" memory all live in the browser. It reads from
 * `dashboard/mock-data.ts` — there is no Task model in the schema and no
 * projects endpoint yet, so that module is the seam where the API will arrive.
 */
export default function WorkspaceHomePage() {
  return <ProjectDashboard />;
}
