import { useAnalytics } from "@obs-unified/analytics-sdk/react";
import { useEffect } from "react";

export function App() {
	const { identify, trackInteraction } = useAnalytics();

	useEffect(() => {
		// Identify your user once you know who they are. The dashboard's
		// user-detail page (`/#/users/<id>`) shows their sessions,
		// traces, AI calls, and replays.
		identify("demo-user", { email: "demo@example.com" });
	}, [identify]);

	const onClick = async () => {
		// Auto-correlation: the click mints an interaction_id, and the
		// fetch below carries it as x-obs-interaction. The server sees
		// it via stampInteractionFromRequest, and every span/log/AI
		// call in that handler inherits it. Open the dashboard's Traces
		// tab to see them stitched together.
		const res = await fetch("/api/hello");
		const body = await res.json();
		trackInteraction("hello_clicked", { status: res.status });
		console.log(body);
	};

	return (
		<main style={{ fontFamily: "system-ui", padding: 32 }}>
			<h1>__APP_NAME__</h1>
			<p>Click the button, then check your collector dashboard.</p>
			<button onClick={onClick} type="button">
				Say hello
			</button>
		</main>
	);
}
