import type { VaultTree } from './vault';
import { titleFromNotePath } from './vault';

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** Extract every [[Title]] referenced in a note body. */
export function extractWikiLinks(body: string): string[] {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;
    while ((m = WIKILINK_RE.exec(body)) !== null) {
        const name = m[1].trim();
        if (name && !out.includes(name)) out.push(name);
    }
    return out;
}

/**
 * Build a title -> note path index from the vault tree.
 * Later entries win on duplicate titles (so deeper/newer notes override).
 */
export function buildWikiIndex(tree: VaultTree): Map<string, string> {
    const index = new Map<string, string>();
    for (const note of tree.notes) {
        index.set(titleFromNotePath(note.path), note.path);
    }
    return index;
}

/** Resolve a [[Title]] to a note path, or null if not found. Case-insensitive. */
export function resolveWikiLink(title: string, index: Map<string, string>): string | null {
    const t = title.trim();
    if (index.has(t)) return index.get(t)!;
    const lower = t.toLowerCase();
    for (const [key, path] of index) {
        if (key.toLowerCase() === lower) return path;
    }
    return null;
}
