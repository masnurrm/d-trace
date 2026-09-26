import type { Route } from 'next';

/**
 * Escape hatch for `typedRoutes`.
 *
 * Typed routes check every literal link at build time, which is what catches a
 * renamed page before it ships. URLs assembled at runtime (filters, paging)
 * cannot be checked that way, so they are cast here - in one reviewable place
 * rather than scattered across components.
 */
export function dynamicRoute(path: string): Route {
  return path as Route;
}
