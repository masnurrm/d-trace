/**
 * shadcn components are generated importing `cn` from here. Re-exporting the
 * app's own implementation keeps one `cn` in the codebase rather than two that
 * could drift in how they resolve Tailwind conflicts.
 */
export { cn } from './utils/cn';
