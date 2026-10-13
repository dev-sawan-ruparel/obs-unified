/**
 * Glue between `@hono/node-server` and the collector app.
 *
 * `serve()` invokes its `fetch` callback as `fetch(request, bindings)` where
 * `bindings` is the Node adapter's `{ incoming, outgoing }` pair. Hono's Node
 * `getConnInfo(c)` reads `c.env.incoming.socket` to report the TCP peer, so
 * those adapter bindings must reach the request env alongside the trusted
 * collector bindings. Calling `app.fetch(request, requestEnv)` and dropping
 * the second argument made every `POST /auth/login` throw inside the login
 * limiter (`Cannot read properties of undefined (reading 'socket')`) and
 * answer 500 — this module exists so that wiring is testable in isolation.
 */

import type { Http2Bindings, HttpBindings } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { CollectorEnv } from "@obsunified/collector";
import type { Context } from "hono";

/** The second argument `@hono/node-server` passes to its `fetch` callback. */
export type NodeAdapterBindings = HttpBindings | Http2Bindings;

/**
 * Per-request env seen by collector handlers on the Node host: the explicit
 * collector allowlist plus the adapter's connection bindings.
 */
export type NodeRequestEnv = CollectorEnv & NodeAdapterBindings;

export type NodeFetchCallback = (
	request: Request,
	bindings: NodeAdapterBindings,
) => Response | Promise<Response>;

interface CollectorFetchApp {
	fetch(request: Request, env: NodeRequestEnv): Response | Promise<Response>;
}

/**
 * Builds the `serve({ fetch })` callback. Every request gets a fresh env
 * object: the trusted collector bindings (`DB`, buckets, secrets, optional
 * Worker-parity keys) and, from the adapter, only `incoming` / `outgoing` so
 * `getConnInfo` can resolve the real TCP peer. `requestEnv` itself is never
 * mutated, so one connection's sockets can never leak into another request.
 */
export function createNodeFetch(
	app: CollectorFetchApp,
	requestEnv: CollectorEnv,
): NodeFetchCallback {
	return (request, bindings) =>
		app.fetch(request, {
			...requestEnv,
			incoming: bindings.incoming,
			outgoing: bindings.outgoing,
		} as NodeRequestEnv);
}

/**
 * Login-limiter client identity for the Node host: the TCP peer address is
 * the only identity a direct client cannot choose. Behind a reverse proxy
 * that peer is the proxy itself, so operators set `TRUST_PROXY=true` to key
 * on the forwarded client address instead (see `trustProxyHeaders`).
 */
export function loginClientAddress(
	c: Context<{ Bindings: CollectorEnv }>,
): string | undefined {
	return getConnInfo(c).remote.address;
}
