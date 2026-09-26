'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { findNavGroup, findNavItem } from './navigation';
import { useBreadcrumbTrail, type Crumb } from './breadcrumb-context';

/**
 * `D-Trace > Sistem > Pengaturan`.
 *
 * The trail is derived from the navigation definition rather than from the URL
 * segments, so the crumb reads the same as the menu item that leads to it
 * instead of exposing a slug.
 */
export function Breadcrumbs({ appName }: { appName: string }) {
  const pathname = usePathname();
  const published = useBreadcrumbTrail();

  // Both lookups pick the *longest* matching href: `/workspace` prefixes
  // `/workspace/project`, so a first-match search would label the Project page
  // "Beranda".
  const item = findNavItem(pathname);
  const group = findNavGroup(pathname);

  // A page that knows where it is wins. Otherwise fall back to the menu
  // definition, which is right for every screen that is just a menu entry.
  const trail: Crumb[] =
    published ??
    [
      group?.label ? { label: group.label } : null,
      item ? { label: item.label } : null,
    ].filter((crumb): crumb is Crumb => crumb !== null);

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
        <li className="shrink-0">
          <Link href="/" className="hover:text-slate-900 dark:hover:text-slate-100">
            {appName}
          </Link>
        </li>

        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1;

          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="truncate hover:text-slate-900 dark:hover:text-slate-100"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={cn(
                    'truncate',
                    isLast && 'font-medium text-slate-900 dark:text-slate-100',
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
