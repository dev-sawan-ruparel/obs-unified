/**
 * RFC 0006 Scenario B — user detail page.
 *
 * Lands when the user clicks a `👤 user-id` chip in the AI dashboard
 * (or anywhere else that renders a user identifier). Shows the user
 * profile header and a `ConnectedRail` keyed on `kind=user` so the rail
 * surfaces the latest session, recent traces, and recent AI calls —
 * the headline chain for Scenario B.
 *
 * The rail-side join (user_profiles → visitor_id → usage_events →
 * signals) is implemented in IdentityIndex.byUser. This component is
 * the UI surface that makes the chain navigable in the browser.
 */

import type { UserProfileDetail } from "@obsunified/types";
import { useEffect, useState } from "react";
import { ConnectedRail } from "../components/ConnectedRail";
import { Card, SectionTitle } from "../components/primitives";
import { StateRow } from "../components/states";
import { useApi } from "../use-api";

export interface UserDashboardProps {
	userId: string;
	onNavigate?: (href: string) => void;
}

// ISO-style datetime, consistent with the monospace-engineering aesthetic
// used elsewhere in the dashboard. Browser locale dates ("5/12/2026, 1:42:05
// AM") feel out of place next to trace IDs and span attributes.
const formatDate = (iso: string): string => {
	try {
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	} catch {
		return iso;
	}
};

// Click-to-copy chip for identifier fields. Lets the user grab a user_id
// or visitor_id without DevTools — they're often the value the user came
// to this page to find.
function CopyCell({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<dd className="group flex min-w-0 items-center gap-1.5" title={value}>
			<span className="truncate">{value}</span>
			<button
				type="button"
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(value);
						setCopied(true);
						setTimeout(() => setCopied(false), 1200);
					} catch {
						// Some browsers block clipboard from non-secure contexts;
						// fall back to silent no-op.
					}
				}}
				className="opacity-0 group-hover:opacity-100 text-[0.625rem] opacity-60 hover:opacity-100 transition-none cursor-pointer flex-none"
				title="Copy"
			>
				{copied ? "✓" : "⧉"}
			</button>
		</dd>
	);
}

export function UserDashboard({ userId, onNavigate }: UserDashboardProps) {
	const api = useApi();
	const [user, setUser] = useState<UserProfileDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		setLoading(true);
		setError(null);
		api<{ user: UserProfileDetail }>(`/users/${encodeURIComponent(userId)}`)
			.then((data) => setUser(data.user))
			.catch((err) =>
				setError(err instanceof Error ? err.message : String(err)),
			)
			.finally(() => setLoading(false));
	}, [api, userId]);

	if (loading) {
		return (
			<div className="flex h-full">
				<div className="flex-1 p-3">
					<StateRow>Loading user profile…</StateRow>
				</div>
			</div>
		);
	}

	if (error || !user) {
		return (
			<div className="flex h-full">
				<div className="flex-1 p-3">
					<StateRow>
						{error
							? `Failed to load user: ${error}`
							: `User ${userId} not found. The user_profiles table is populated by /v1/identify calls from @obsunified/analytics-sdk's tracker.identify().`}
					</StateRow>
				</div>
				<ConnectedRail
					entityKind="user"
					entityId={userId}
					onNavigate={onNavigate}
				/>
			</div>
		);
	}

	const displayName = user.name ?? user.email ?? user.userId;
	const propertyEntries = Object.entries(user.properties);
	const isHeavySpender = user.properties.heavy_spender === true;

	return (
		<div className="flex h-full">
			<div className="flex-1 overflow-y-auto p-3">
				<header className="mb-4 flex items-start gap-3">
					<div className="flex h-12 w-12 flex-none items-center justify-center bg-sys-surface-high text-[1.25rem] font-bold">
						👤
					</div>
					<div className="min-w-0 flex-1">
						{/* Name + badge: min-w-0 + truncate so a long display name
						    doesn't push the badge onto a second line, and
						    whitespace-nowrap on the badge so it never breaks mid-word
						    (the prior "HEAVY / SPENDER" two-line wrap on narrow
						    viewports). */}
						<div className="flex items-center gap-2 min-w-0">
							<h1
								className="font-mono text-[1rem] font-bold tracking-[-0.01em] truncate"
								title={displayName}
							>
								{displayName}
							</h1>
							{isHeavySpender && (
								<span className="flex-none whitespace-nowrap border-[1px] border-sys-warning bg-sys-warning/10 px-1.5 py-0.5 font-mono text-[0.625rem] font-bold uppercase tracking-[0.08em] text-sys-warning">
									Heavy Spender
								</span>
							)}
						</div>
						<div
							className="mt-0.5 font-mono text-[0.75rem] opacity-70 truncate"
							title={user.userId}
						>
							user_id: {user.userId}
						</div>
					</div>
				</header>

				<Card>
					<SectionTitle title="Identity" />
					{/* Identity fields are the value the user came here for — they
					    must be reachable. Each value gets `title=` for hover, plus
					    a copy button on the two IDs (the values most often pasted
					    into search/grep/SQL elsewhere). */}
					<dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
						<dt className="opacity-60">user_id</dt>
						<CopyCell value={user.userId} />
						<dt className="opacity-60">visitor_id</dt>
						<CopyCell value={user.visitorId} />
						{user.email && (
							<>
								<dt className="opacity-60">email</dt>
								<dd className="truncate" title={user.email}>
									{user.email}
								</dd>
							</>
						)}
						{user.name && (
							<>
								<dt className="opacity-60">name</dt>
								<dd className="truncate" title={user.name}>
									{user.name}
								</dd>
							</>
						)}
						<dt className="opacity-60">first seen</dt>
						<dd title={user.firstSeenAt}>{formatDate(user.firstSeenAt)}</dd>
						<dt className="opacity-60">last seen</dt>
						<dd title={user.lastSeenAt}>{formatDate(user.lastSeenAt)}</dd>
					</dl>
				</Card>

				{propertyEntries.length > 0 && (
					<Card className="mt-3">
						<SectionTitle title="Properties" />
						<dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
							{propertyEntries.map(([k, v]) => (
								<div key={k} className="contents">
									<dt className="opacity-60">{k}</dt>
									<dd className="truncate" title={String(v)}>
										{String(v)}
									</dd>
								</div>
							))}
						</dl>
					</Card>
				)}

				{/* Hint copy: direction depends on viewport. On narrow viewports
				    the rail stacks below; on desktop it sits to the right. CSS-
				    only switch via two arrows in different breakpoint visibilities. */}
				<div className="mt-3 font-mono text-[0.6875rem] opacity-50">
					Pivot into this user's activity via the Connected Rail
					<span className="hidden md:inline"> →</span>
					<span className="inline md:hidden"> ↓</span>
				</div>
			</div>
			<ConnectedRail
				entityKind="user"
				entityId={userId}
				onNavigate={onNavigate}
			/>
		</div>
	);
}
