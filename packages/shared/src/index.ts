/**
 * @dtrace/shared — the contract between `@dtrace/web` and `@dtrace/api`.
 *
 * Rule of thumb: if the frontend and backend must agree on it (a payload shape,
 * a role name, an error code), it belongs here. Nothing in this package may
 * import from an app workspace, touch `process.env`, or depend on Node or DOM
 * globals — it has to run in both runtimes.
 */
export * from './constants/index.js';
export * from './schemas/index.js';
export * from './types/index.js';
export * from './utils/index.js';
