import type { SessionInfo } from "./session-manager.js";

interface SessionTreeNode {
	info: SessionInfo;
	children: SessionTreeNode[];
}

interface FlatNode {
	info: SessionInfo;
	depth: number;
	isLast: boolean;
	ancestorContinues: boolean[];
}

/**
 * Build a parent-child tree structure from flat session list.
 */
export function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
	const byPath = new Map<string, SessionTreeNode>();

	// Create nodes for all sessions
	for (const info of sessions) {
		byPath.set(info.path, { info, children: [] });
	}

	// Build parent-child relationships
	const roots: SessionTreeNode[] = [];
	for (const info of sessions) {
		const node = byPath.get(info.path)!;
		if (info.parentSessionPath) {
			const parentNode = byPath.get(info.parentSessionPath);
			if (parentNode) {
				parentNode.children.push(node);
			} else {
				roots.push(node);
			}
		} else {
			roots.push(node);
		}
	}

	// Sort children and roots by modified date (descending)
	const sortNodes = (nodes: SessionTreeNode[]) => {
		nodes.sort((a, b) => b.info.modified.getTime() - a.info.modified.getTime());
		for (const node of nodes) {
			sortNodes(node.children);
		}
	};
	sortNodes(roots);

	return roots;
}

/**
 * Flatten tree into display list with depth and continuation metadata.
 */
export function flattenSessionTree(roots: SessionTreeNode[]): FlatNode[] {
	const result: FlatNode[] = [];

	const walk = (node: SessionTreeNode, depth: number, ancestorContinues: boolean[], isLast: boolean): void => {
		result.push({ info: node.info, depth, isLast, ancestorContinues });

		for (let i = 0; i < node.children.length; i++) {
			const childIsLast = i === node.children.length - 1;
			const continues = depth > 0 ? !isLast : false;
			walk(node.children[i]!, depth + 1, [...ancestorContinues, continues], childIsLast);
		}
	};

	for (let i = 0; i < roots.length; i++) {
		walk(roots[i]!, 0, [], i === roots.length - 1);
	}

	return result;
}

/**
 * Build tree prefix string (├─, └─, │) for a flat node.
 */
export function buildTreePrefix(node: FlatNode): string {
	if (node.depth === 0) {
		return "";
	}

	const parts = node.ancestorContinues.map((continues) => (continues ? "│  " : "   "));
	const branch = node.isLast ? "└─ " : "├─ ";
	return parts.join("") + branch;
}
