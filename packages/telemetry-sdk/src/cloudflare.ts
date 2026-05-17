// Cloudflare Workers-specific surface.
//
// Split out from the main entry so Node.js / non-Workers consumers don't
// pay the @cloudflare/workers-types ambient cost. The runtime code itself
// works anywhere `D1Database` / `R2Bucket` types exist (i.e. Workers); on
// other runtimes import from "@obs-unified/telemetry-sdk" instead.

export { type WrapD1Options, wrapD1 } from "./d1";
export { type WrapR2Options, wrapR2 } from "./r2";
export { type WrapFetchOptions, wrapFetch } from "./fetch";
