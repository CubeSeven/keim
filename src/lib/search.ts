import MiniSearch from 'minisearch';
import { db, getFullPath } from './db';

// Define what a documented returned from search looks like
export interface SearchResult {
    id: number;
    title: string;
    excerpt?: string;
    path?: string;
    score: number;
    match: unknown;
}

// Global instance of MiniSearch
// We index BOTH the 'title' and the 'content'.
// We return the title so we can display it right away in the UI.
export const miniSearch = new MiniSearch({
    fields: ['title', 'content', 'tags'], // fields to index for full-text search
    storeFields: ['title', 'parentId', 'fullPath', 'icon'], // fields to return with search results
    searchOptions: {
        boost: { title: 2, tags: 1.5 }, // Title matches are ranked higher, then tags, then content
        fuzzy: 0.2, // Allow typos (e.g. 1 mistake per 5 chars)
        prefix: true // "rea" matches "react"
    }
});

/**
 * Initializes the MiniSearch index by pulling all notes and their contents from IndexedDB.
 * This should be called once the app is ready/synced.
 */
export async function buildSearchIndex() {
    console.log('[Search] Building index started...');
    const start = performance.now();

    // 1. Clear existing index
    miniSearch.removeAll();

    // 2. Fetch all notes (excluding folders and deleted items)
    const notes = await db.items.where('type').equals('note').filter(n => !n.isDeleted).toArray();

    // 3. Fetch all contents
    // To avoid hundreds of individual DB lookups, grab them all and map them internally.
    const contents = await db.contents.toArray();
    const contentMap = new Map(contents.map(c => [c.id, c.content]));

    // 4. Combine them into documents for MiniSearch
    const documents = notes.map(note => {
        const parentPath = getFullPath(note.id!, notes);
        return {
            id: note.id,
            title: note.title,
            content: contentMap.get(note.id!) || '',
            tags: note.tags?.join(' ') || '',
            parentId: note.parentId,
            fullPath: parentPath || 'Root',
            icon: note.icon
        };
    });

    // 5. Index them!
    miniSearch.addAll(documents);

    console.log(`[Search] Built index with ${documents.length} notes in ${Math.round(performance.now() - start)}ms.`);
}

/**
 * Update the search index for a single note.
 * Call this when a note is created, renamed, or modified.
 */
export function updateSearchIndex(noteId: number, title: string, content: string, parentId: number, fullPath: string, icon?: string, tags?: string[]) {
    const tagsStr = tags?.join(' ') || '';
    const doc = { id: noteId, title, content, parentId, fullPath, icon, tags: tagsStr };
    if (!miniSearch.has(noteId)) {
        miniSearch.add(doc);
    } else {
        miniSearch.replace(doc);
    }
}

/**
 * Remove a note from the search index.
 * Call this when a note is deleted.
 */
export function removeFromSearchIndex(noteId: number) {
    if (miniSearch.has(noteId)) {
        miniSearch.discard(noteId);
    }
}
