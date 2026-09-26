import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The version string shown in Settings and the footer, e.g.
 * `1.0.0+56120f5075dfa9cb62a33236f1fc4dc74a98d3b8`.
 *
 * It is read from the build rather than stored in the database on purpose: a
 * number an operator can type is a number that can disagree with what is
 * actually deployed, which makes it useless for support.
 */
export function resolveVersion(appVersion?: string, gitSha?: string): string {
  if (appVersion) return appVersion;

  const base = readPackageVersion() ?? '0.0.0';
  const build = gitSha?.trim() || 'dev';
  return `${base}+${build}`;
}

function readPackageVersion(): string | null {
  try {
    // dist/common/utils -> dist/common -> dist -> workspace root
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of ['../../../package.json', '../../../../package.json']) {
      try {
        const raw = readFileSync(join(here, candidate), 'utf8');
        const parsed = JSON.parse(raw) as { name?: string; version?: string };
        if (parsed.name === '@dtrace/api' && parsed.version) return parsed.version;
      } catch {
        // Try the next candidate; the depth differs between src and dist.
      }
    }
  } catch {
    // Fall through to the caller's default.
  }
  return null;
}
