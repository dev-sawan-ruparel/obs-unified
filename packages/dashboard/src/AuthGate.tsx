import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Login } from "./Login";

/**
 * Gates children behind a dashboard-password session.
 *
 * On mount, calls GET /auth/check (same-origin — configure your dev
 * proxy or serve the SPA from the collector). If authenticated, renders
 * children; otherwise renders the <Login /> form, which reruns the
 * check on success.
 *
 * If your dashboard is served by the collector at /dashboard/*, you
 * don't strictly need this component — the collector's dashboard-auth
 * middleware already 302s to the login route. AuthGate is the SPA
 * story for when the dashboard lives on a different origin (Vite dev
 * server, embedded SPA, etc).
 */
export function AuthGate({ children }: { children: ReactNode }) {
	const [state, setState] = useState<"checking" | "authed" | "anon">(
		"checking",
	);

	const check = useCallback(async () => {
		try {
			const r = await fetch("/auth/check", { credentials: "include" });
			// 404 means the collector hasn't wired up dashboard auth at all
			// (DASHBOARD_PASSWORD unset). In that case there's nothing to
			// gate against, so let the user through instead of showing a
			// login form that would never succeed.
			if (r.status === 404) {
				setState("authed");
				return;
			}
			if (!r.ok) {
				setState("anon");
				return;
			}
			const data = (await r.json().catch(() => ({}))) as {
				authenticated?: boolean;
			};
			setState(data.authenticated ? "authed" : "anon");
		} catch {
			setState("anon");
		}
	}, []);

	useEffect(() => {
		check();
	}, [check]);

	if (state === "checking") {
		return (
			<div className="flex h-screen items-center justify-center bg-sys-bg font-sans text-[0.75rem] font-bold uppercase tracking-[0.05em] text-sys-outline">
				CHECKING SESSION…
			</div>
		);
	}
	if (state === "anon") {
		return <Login onSuccess={() => setState("authed")} />;
	}
	return <>{children}</>;
}
