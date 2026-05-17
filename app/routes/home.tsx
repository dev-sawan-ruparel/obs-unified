import type { Route } from "./+types/home";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { Link } from "react-router";
import { baseOptions } from "@/lib/layout.shared";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "obs-unified — documentation" },
		{
			name: "description",
			content:
				"Install, instrument, and read the unified observability dashboard.",
		},
	];
}

export default function Home() {
	return (
		<HomeLayout {...baseOptions()}>
			<main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center gap-8">
				<div className="flex flex-col gap-4 max-w-2xl">
					<h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
						obs-unified
					</h1>
					<p className="text-fd-muted-foreground text-base sm:text-lg">
						A single observability stack where every signal — traces,
						logs, AI calls, sessions, replays, alerts, profiles — is
						reachable from every other in ≤2 clicks. End-to-end
						click-to-CPU on Cloudflare Workers + D1 + R2.
					</p>
					<div className="flex justify-center gap-3 pt-2">
						<Link
							to="/docs"
							className="rounded-md bg-fd-primary text-fd-primary-foreground px-4 py-2 text-sm font-semibold hover:bg-fd-primary/90"
						>
							Read the docs
						</Link>
						<Link
							to="/docs/installation"
							className="rounded-md border border-fd-border px-4 py-2 text-sm font-semibold hover:bg-fd-accent"
						>
							Quick install
						</Link>
					</div>
				</div>
				<div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 max-w-4xl w-full mt-8">
					<Tile
						to="/docs/installation"
						title="Install"
						body="Clone, pnpm install, make run."
					/>
					<Tile
						to="/docs/sdks"
						title="SDKs"
						body="@obs-unified/analytics-sdk + @obs-unified/telemetry-sdk."
					/>
					<Tile
						to="/docs/instrumenting"
						title="Instrument"
						body="React app, Node server, Workers."
					/>
					<Tile
						to="/docs/what-to-expect"
						title="What you'll see"
						body="The Connected rail, two scenarios end-to-end."
					/>
				</div>
			</main>
		</HomeLayout>
	);
}

function Tile({
	to,
	title,
	body,
}: {
	to: string;
	title: string;
	body: string;
}) {
	return (
		<Link
			to={to}
			className="text-left rounded-lg border border-fd-border bg-fd-card p-4 hover:bg-fd-accent transition-colors"
		>
			<div className="font-semibold text-sm mb-1">{title}</div>
			<div className="text-xs text-fd-muted-foreground leading-relaxed">
				{body}
			</div>
		</Link>
	);
}
