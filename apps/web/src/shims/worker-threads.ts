// Browser noop shim for Node's `worker_threads` module.
//
// rrweb (used by ReplayDashboard) does a feature-detect `require("worker_threads")`
// to decide whether to use a worker for compression. In the browser the import
// resolves and returns `undefined` for everything, which is the correct
// fall-through path. This shim exists purely so Vite stops logging the
// "Module worker_threads has been externalized" warning on every render.

export const Worker = undefined;
export const isMainThread = true;
export const parentPort = null;
export const workerData = undefined;
export default {};
