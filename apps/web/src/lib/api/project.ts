import type { ProjectView } from '@dtrace/shared';
import { ApiRequestError, apiFetch } from './server';

/**
 * The project behind a `/workspace/project/[id]/…` page.
 *
 * Fetching it is also what enforces access: someone without `viewProject` on
 * the node gets the same 404 as anyone naming a project that does not exist.
 */
export async function loadProject(id: string): Promise<ProjectView | null> {
  try {
    const result = await apiFetch<ProjectView>(`/workspace/projects/${id}`);
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
