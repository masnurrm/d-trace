'use client';

import { useSyncExternalStore } from 'react';

/**
 * The documents this browser has opened, per project.
 *
 * Deliberately local and not on the server: "what did *I* just look at" is a
 * question about this person on this machine, and answering it from the
 * database would mean writing a row on every page view — a lot of traffic to
 * record something nobody else will ever read.
 *
 * The consequence is stated plainly in the UI: the list starts empty, and a
 * different browser has a different list.
 */

const STORAGE_KEY = 'dtrace.recentlyViewed.documents';

/** Per project, because the card asking the question sits on a project page. */
const PER_PROJECT = 10;

/** Projects kept at all, so a long-lived browser cannot grow this forever. */
const MAX_PROJECTS = 20;

export interface ViewedDocument {
  id: string;
  title: string;
  viewedAt: string;
}

type Store = Record<string, ViewedDocument[]>;

/** Same-tab writes fire this; other tabs arrive through `storage`. */
const CHANGED = 'dtrace:recently-viewed';

function read(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    // Storage is shared with the user, who may edit it, and with older
    // versions of this code. Anything unexpected is treated as "no history"
    // rather than allowed to crash the page it decorates.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // A private window can refuse storage. The page still works; it just
    // forgets, which is not worth telling the reader about.
  }
}

/**
 * Records that a document was opened, newest first and without duplicates.
 *
 * Re-opening a document moves it to the top rather than adding a second entry:
 * the list answers "what have I been working on", and the same file five times
 * is one answer, not five.
 */
export function recordView(projectId: string, document: { id: string; title: string }): void {
  const store = read();
  const current = store[projectId] ?? [];

  const next: ViewedDocument[] = [
    { id: document.id, title: document.title, viewedAt: new Date().toISOString() },
    ...current.filter((entry) => entry.id !== document.id),
  ].slice(0, PER_PROJECT);

  const pruned: Store = { ...store, [projectId]: next };

  // Oldest-touched projects fall off the end once there are too many.
  const projects = Object.keys(pruned);
  if (projects.length > MAX_PROJECTS) {
    const byRecency = projects.sort((a, b) => {
      const left = pruned[a]?.[0]?.viewedAt ?? '';
      const right = pruned[b]?.[0]?.viewedAt ?? '';
      return right.localeCompare(left);
    });

    for (const stale of byRecency.slice(MAX_PROJECTS)) delete pruned[stale];
  }

  write(pruned);
}

/** Forgets one project's history, for the "clear" action on the card. */
export function clearViews(projectId: string): void {
  const store = read();
  if (!store[projectId]) return;

  const next = { ...store };
  delete next[projectId];
  write(next);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Cached so the snapshot is referentially stable between changes.
 *
 * `useSyncExternalStore` compares snapshots by identity and re-renders when
 * they differ; parsing the JSON afresh on every call would return a new array
 * every time and loop forever.
 */
let cachedRaw: string | null = null;
let cachedStore: Store = {};

function snapshot(): Store {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }

  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedStore = read();
  }

  return cachedStore;
}

const EMPTY: ViewedDocument[] = [];

/**
 * One frozen object, not a fresh one per call.
 *
 * `useSyncExternalStore` compares snapshots by identity. A server snapshot that
 * built `{}` on every call would differ from itself every render, and React
 * refuses that outright — it is the same trap `snapshot()` above caches against,
 * and this side needs the same treatment.
 */
const EMPTY_STORE: Store = {};
const serverSnapshot = (): Store => EMPTY_STORE;

/** The documents opened in this project, newest first. Empty during SSR. */
export function useRecentlyViewed(projectId: string): ViewedDocument[] {
  const store = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return store[projectId] ?? EMPTY;
}
