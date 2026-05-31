# @obs-unified/pprof-decoder

Minimal pprof decoder + encoder. Runs in browsers and Cloudflare Workers (uses
the platform `DecompressionStream`/`CompressionStream` APIs — no Node-native
dependencies, no Emscripten).

```ts
import { decodeProfile, encodeProfile } from "@obs-unified/pprof-decoder";

const profile = await decodeProfile(gzippedBuffer);
profile.sample.forEach((s) => console.log(s.value, s.locationId));

const reEncoded = await encodeProfile(profile);
```

Used by the collector's `/v1/profiles` ingest and by the dashboard's flame-graph
renderer. Designed to do **decode + minor re-encode**, not full profile
manipulation — for that, use Google's `pprof` toolchain.
