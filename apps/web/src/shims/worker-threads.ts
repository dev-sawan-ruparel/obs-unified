// Browser shim for Node's `worker_threads` module.
//
// Why this exists:
// `fflate` (transitively pulled by rrweb-snapshot for replay compression)
// supports running gzip work in a Node worker thread when available. Its
// dual-runtime detection looks like this:
//
//     var Worker;
//     try {
//       Worker = require("worker_threads").Worker;
//     } catch (e) {}
//
// In a real browser bundle this `try/catch` swallows the missing-module
// error and `Worker` stays undefined — the correct browser fallback.
//
// Vite's CJS externalizer breaks that contract: instead of letting the
// `require("worker_threads")` call throw, it returns a stub object that
// emits a console warning *the first time `.Worker` is accessed*. The
// try/catch never fires, the warning fires on every render.
//
// This module replaces the externalized stub with a real noop module so
// fflate's contract is honored — `Worker` reads as `undefined`, no throw,
// no warn, fflate continues with its non-worker code path which is the
// same one it would have taken in any other browser bundle.
//
// Tracking: this is the standard fix for CJS Node-built-ins surfacing
// through Vite. Once fflate ships a proper `browser` exports field
// (issue 101kjkj/fflate#214 is one of several upstream threads), this
// shim and the alias in vite.config.ts can be removed.

export const Worker = undefined;
export const isMainThread = true;
export const parentPort = null;
export const workerData = undefined;
export default { Worker: undefined };
