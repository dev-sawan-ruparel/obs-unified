const RAIL_COLLAPSED_KEY = "obs.railCollapsed";
const THEME_KEY = "obs.theme";

export function readRailCollapsed(): boolean {
	if (typeof localStorage === "undefined") return false;
	try {
		return localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
	} catch {
		return false;
	}
}

export function writeRailCollapsed(collapsed: boolean): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? "1" : "0");
	} catch {
		// ignore
	}
}

export type Theme = "light" | "dark";

export function readTheme(): Theme {
	if (typeof localStorage === "undefined") return "light";
	try {
		const v = localStorage.getItem(THEME_KEY);
		return v === "dark" ? "dark" : "light";
	} catch {
		return "light";
	}
}

export function writeTheme(theme: Theme): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(THEME_KEY, theme);
	} catch {
		// ignore
	}
}
