import type { Metadata } from 'next';
import { ProjectDashboard } from '@/components/workspace/dashboard/project-dashboard';

export const metadata: Metadata = { title: 'Workspace' };

/** Live project progress from development through SIT/UAT. */
export default function WorkspaceHomePage() {
  return <ProjectDashboard />;
}
