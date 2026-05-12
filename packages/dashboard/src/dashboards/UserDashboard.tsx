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

import { useEffect, useState } from "react";
import type { UserProfileDetail } from "@obs/types";
import { ConnectedRail } from "../components/ConnectedRail";
import { Card, SectionTitle } from "../components/primitives";
import { StateRow } from "../components/states";
import { useApi } from "../use-api";

export interface UserDashboardProps {
	userId: string;
	onNavigate?: (href: string) => void;
}

const formatDate = (iso: string): string => {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
};

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
							: `User ${userId} not found. The user_profiles table is populated by /v1/identify calls from @obs/analytics-sdk's tracker.identify().`}
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
						<div className="flex items-center gap-2">
							<h1 className="font-mono text-[1rem] font-bold tracking-[-0.01em]">
								{displayName}
							</h1>
							{isHeavySpender && (
								<span className="border-[1px] border-sys-warning bg-sys-warning/10 px-1.5 py-0.5 font-mono text-[0.625rem] font-bold uppercase tracking-[0.08em] text-sys-warning">
									Heavy Spender
								</span>
							)}
						</div>
						<div className="mt-0.5 font-mono text-[0.75rem] opacity-70">
							user_id: {user.userId}
						</div>
					</div>
				</header>

				<Card>
					<SectionTitle title="Identity" />
					<dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
						<dt className="opacity-60">user_id</dt>
						<dd className="truncate">{user.userId}</dd>
						<dt className="opacity-60">visitor_id</dt>
						<dd className="truncate">{user.visitorId}</dd>
						{user.email && (
							<>
								<dt className="opacity-60">email</dt>
								<dd className="truncate">{user.email}</dd>
							</>
						)}
						{user.name && (
							<>
								<dt className="opacity-60">name</dt>
								<dd className="truncate">{user.name}</dd>
							</>
						)}
						<dt className="opacity-60">first seen</dt>
						<dd>{formatDate(user.firstSeenAt)}</dd>
						<dt className="opacity-60">last seen</dt>
						<dd>{formatDate(user.lastSeenAt)}</dd>
					</dl>
				</Card>

				{propertyEntries.length > 0 && (
					<Card className="mt-3">
						<SectionTitle title="Properties" />
						<dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
							{propertyEntries.map(([k, v]) => (
								<div key={k} className="contents">
									<dt className="opacity-60">{k}</dt>
									<dd className="truncate">{String(v)}</dd>
								</div>
							))}
						</dl>
					</Card>
				)}

				<div className="mt-3 font-mono text-[0.6875rem] opacity-50">
					Pivot into this user's activity via the Connected rail →
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
