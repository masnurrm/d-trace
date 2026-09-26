import 'server-only';
import { cache } from 'react';
import type { AppSettingsView } from '@dtrace/shared';
import { apiFetch, ApiRequestError } from './server';

/**
 * Sensible values for when the API cannot be reached. The shell still has to
 * render - a login screen that shows nothing because settings failed to load
 * is worse than one showing the default name.
 */
export const FALLBACK_SETTINGS: AppSettingsView = {
  identity: { appName: 'D-Trace', tagline: null, version: '0.0.0+unknown' },
  marquee: { enabled: false, speedSeconds: 15, items: [] },
  footer: { text: null, align: 'CENTER', showAppName: true, showVersion: false },
  updatedAt: null,
};

/**
 * Settings for the current render, deduplicated per request by `cache()`:
 * the layout, the page and any component can each ask without adding calls.
 */
export const getSettings = cache(async (): Promise<AppSettingsView> => {
  try {
    const result = await apiFetch<AppSettingsView>('/settings');
    return result.data;
  } catch (error) {
    // An unauthenticated caller gets the fallback; anything else is a real
    // failure and should surface rather than be papered over.
    if (error instanceof ApiRequestError && error.isUnauthorized) return FALLBACK_SETTINGS;
    throw error;
  }
});
