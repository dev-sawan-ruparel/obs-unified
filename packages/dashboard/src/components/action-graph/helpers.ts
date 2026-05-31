import type { ActionRef, TreeNode } from "./types";

// Simple line diff helper to build side-by-side or inline prompt diffs without heavy packages.
export interface DiffSegment {
	type: "added" | "removed" | "same";
	value: string;
}

export function computeDiff(original: string, modified: string): DiffSegment[] {
	const origLines = original.split("\n");
	const modLines = modified.split("\n");
	const segments: DiffSegment[] = [];

	let i = 0;
	let j = 0;

	while (i < origLines.length || j < modLines.length) {
		if (
			i < origLines.length &&
			j < modLines.length &&
			origLines[i] === modLines[j]
		) {
			segments.push({ type: "same", value: origLines[i] });
			i++;
			j++;
		} else if (
			j < modLines.length &&
			(i >= origLines.length || !origLines.slice(i).includes(modLines[j]))
		) {
			segments.push({ type: "added", value: modLines[j] });
			j++;
		} else {
			segments.push({ type: "removed", value: origLines[i] });
			i++;
		}
	}

	return segments;
}

// Convert a flat list of Actions into a recursive tree structure.
export function buildActionTree(actions: ActionRef[]): TreeNode[] {
	const nodeMap = new Map<string, TreeNode>();
	for (const a of actions) {
		nodeMap.set(a.id, { action: a, children: [] });
	}

	const roots: TreeNode[] = [];
	for (const node of nodeMap.values()) {
		const parentId = node.action.causedByActionId;
		if (parentId && nodeMap.has(parentId)) {
			nodeMap.get(parentId)?.children.push(node);
		} else {
			roots.push(node);
		}
	}

	// Sort roots and children chronologically by startedAt
	const sortFn = (a: TreeNode, b: TreeNode) => {
		return a.action.startedAt.localeCompare(b.action.startedAt);
	};
	roots.sort(sortFn);
	for (const node of nodeMap.values()) {
		node.children.sort(sortFn);
	}

	return roots;
}
