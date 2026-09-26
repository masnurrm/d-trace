'use client';

import { useSyncExternalStore } from 'react';

/** The reader's own zone, resolved once — it does not change while they read. */
const localZone =
  typeof Intl === 'undefined' ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Nothing to subscribe to: a browser's timezone does not change under it. */
const subscribe = () => () => {};

const getSnapshot = () => localZone;

/**
 * On the server, there is no reader to have a zone.
 *
 * Returning `undefined` here is what makes the first paint match the HTML:
 * every formatter falls back to UTC, the server and the browser produce the
 * same characters, and React hydrates without complaint. The swap to local time
 * happens on the render straight after, once this hook is allowed to answer.
 */
const getServerSnapshot = () => undefined;

/**
 * The timezone to format in — `undefined` until hydration, then the reader's.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState`: it is the API
 * that exists precisely to say "the server and the client know different
 * things", and it does the swap in the same commit as hydration instead of a
 * frame later.
 */
export function useLocalTimeZone(): string | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
