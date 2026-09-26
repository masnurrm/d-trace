import {
  CalendarDays,
  ClipboardList,
  Clock,
  FileStack,
  FileText,
  FolderKanban,
  Home,
  LayoutDashboard,
  Network,
  Settings,
  ShieldCheck,
  Star,
  Tag,
  Users,
} from 'lucide-react';
import type { Route } from 'next';
import type { LucideIcon } from 'lucide-react';
import { ROLES, canOpenAdminPanel, hasAtLeastRole, type AppMode, type Role } from '@dtrace/shared';

export interface NavItem {
  href: Route;
  label: string;
  Icon: LucideIcon;
  /** Minimum role needed to see the link. */
  minRole?: Role;
  /** Shown as a muted "Segera" tag: the route exists, the feature does not yet. */
  comingSoon?: boolean;
}

export interface NavGroup {
  /** Small uppercase heading above the group. Null renders an unlabelled group. */
  label: string | null;
  items: NavItem[];
}

/**
 * The application has two halves, and the sidebar is the seam between them.
 *
 * **Workspace** is where the work itself happens: projects and the documents
 * produced from them. Everyone who signs in has it.
 *
 * **Admin Panel** is where the platform is configured: accounts, hierarchy,
 * document templates, permissions, the audit trail. Only a SUPER_ADMIN may
 * open it — `ADMIN` is a role someone carries *inside* a workspace, not a
 * lesser key to this half.
 *
 * Hiding a link is presentation, not protection: the route group's layout and
 * the API both check the role again. This only stops the UI from offering a
 * door that will not open.
 */

/** Everything under `/workspace`. */
export const WORKSPACE_GROUPS: NavGroup[] = [
  {
    label: 'Menu Utama',
    items: [
      { href: '/workspace', label: 'Beranda', Icon: Home },
      { href: '/workspace/terbaru', label: 'Terbaru', Icon: Clock },
      { href: '/workspace/favorit', label: 'Favorit', Icon: Star },
      { href: '/workspace/project', label: 'Project', Icon: FolderKanban },
      { href: '/workspace/dokumen', label: 'Dokumen', Icon: FileStack },
    ],
  },
];

/** Everything outside `/workspace`: the configuration of the platform itself. */
export const ADMIN_GROUPS: NavGroup[] = [
  {
    label: 'Menu Utama',
    items: [
      { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
      { href: '/users', label: 'User', Icon: Users },
    ],
  },
  {
    label: 'Konfigurasi',
    items: [
      { href: '/hierarki', label: 'Hierarki', Icon: Network },
      { href: '/jenis-node', label: 'Jenis Node', Icon: Tag },
      { href: '/dokumen-template', label: 'Dokumen Template', Icon: FileText },
      { href: '/role-akses', label: 'Role & Akses', Icon: ShieldCheck },
      { href: '/hari-libur', label: 'Hari Libur', Icon: CalendarDays },
      { href: '/audit', label: 'Audit Log', Icon: ClipboardList },
    ],
  },
  {
    label: 'Sistem',
    items: [{ href: '/settings', label: 'Pengaturan', Icon: Settings }],
  },
];

export const MODE_GROUPS: Record<AppMode, NavGroup[]> = {
  workspace: WORKSPACE_GROUPS,
  admin: ADMIN_GROUPS,
};

export const MODE_LABELS: Record<AppMode, string> = {
  workspace: 'Workspace',
  admin: 'Admin Panel',
};

/** Where switching into a mode lands. */
export const MODE_HOME: Record<AppMode, Route> = {
  workspace: '/workspace',
  admin: '/dashboard',
};

/**
 * Which half a path belongs to.
 *
 * Derived from the URL rather than held in state: a deep link, a refresh and a
 * back button then all agree on which sidebar to draw, and there is no mode
 * that can drift out of step with the page being rendered.
 */
export function modeForPath(pathname: string): AppMode {
  // Derived from the admin route list rather than from a `/workspace` prefix,
  // so a page that belongs to neither half — `/bantuan`, say — falls to the
  // Workspace. Defaulting the other way would show an account that can never
  // open the Admin Panel a sidebar claiming it is inside one.
  const isAdminPath = ADMIN_GROUPS.flatMap((group) => group.items).some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return isAdminPath ? 'admin' : 'workspace';
}

/** The modes this role may switch between, in the order they are offered. */
export function availableModes(role: Role): AppMode[] {
  return canOpenAdminPanel(role) ? ['workspace', 'admin'] : ['workspace'];
}

/** Groups that end up empty for this role are dropped, headings included. */
export function visibleNavGroups(role: Role, mode: AppMode): NavGroup[] {
  return MODE_GROUPS[mode]
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.minRole || hasAtLeastRole(role, item.minRole)),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Flat lookup used by the breadcrumb to name the current page. It searches both
 * halves, because the crumb has to name the page it is actually on — which mode
 * that page belongs to is the sidebar's problem, not the trail's.
 */
export function findNavItem(pathname: string): NavItem | undefined {
  return [...WORKSPACE_GROUPS, ...ADMIN_GROUPS]
    .flatMap((group) => group.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    // `/workspace` prefixes `/workspace/project`, so the longest match wins.
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** The group a path sits in, for the middle crumb. */
export function findNavGroup(pathname: string): NavGroup | undefined {
  const item = findNavItem(pathname);
  if (!item) return undefined;
  return [...WORKSPACE_GROUPS, ...ADMIN_GROUPS].find((group) => group.items.includes(item));
}

/** Kept so a role check reads the same in navigation and in a route guard. */
export { canOpenAdminPanel, ROLES };
