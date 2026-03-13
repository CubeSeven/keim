/**
 * Tests for the miniSearch library (search.ts).
 * Validates that notes (including titles, content, and tags) are correctly
 * indexed, searchable, updated, and removed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import MiniSearch from 'minisearch';

// We test the MiniSearch configuration in isolation (no Dexie needed).
const createIndex = () => new MiniSearch({
    fields: ['title', 'content', 'tags'],
    storeFields: ['title', 'parentId'],
    searchOptions: {
        boost: { title: 2, tags: 1.5 },
        fuzzy: 0.2,
        prefix: true,
    },
});

describe('Search Index – Notes and Tags', () => {
    let index: MiniSearch;

    beforeEach(() => {
        index = createIndex();
    });

    it('should index a note and find it by title', () => {
        index.add({ id: 1, title: 'My Note', content: 'Hello world', tags: '', parentId: 0 });
        const results = index.search('My Note');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].id).toBe(1);
    });

    it('should find a note by a partial title prefix', () => {
        index.add({ id: 2, title: 'Architecture Overview', content: '', tags: '', parentId: 0 });
        const results = index.search('Archit', { prefix: true });
        expect(results.some(r => r.id === 2)).toBe(true);
    });

    it('should find a note by a single tag', () => {
        index.add({ id: 3, title: 'Tagged Note', content: '', tags: 'batman', parentId: 0 });
        const results = index.search('batman', { fields: ['title', 'content', 'tags'] });
        expect(results.some(r => r.id === 3)).toBe(true);
    });

    it('should find a note by a tag prefix (partial match)', () => {
        index.add({ id: 4, title: 'Partial Tag Note', content: '', tags: 'batmobile batball batman', parentId: 0 });
        const results = index.search('bat', { prefix: true, fields: ['title', 'content', 'tags'] });
        expect(results.some(r => r.id === 4)).toBe(true);
    });

    it('should NOT find a note after it is removed from the index', () => {
        index.add({ id: 5, title: 'Ephemeral Note', content: 'gone', tags: '', parentId: 0 });
        expect(index.search('Ephemeral').length).toBeGreaterThan(0);

        index.discard(5);
        const results = index.search('Ephemeral');
        expect(results.some(r => r.id === 5)).toBe(false);
    });

    it('should reflect updated tags after replacing a document', () => {
        index.add({ id: 6, title: 'Updatable Note', content: '', tags: 'oldtag', parentId: 0 });
        expect(index.search('oldtag', { fields: ['tags'] }).some(r => r.id === 6)).toBe(true);

        index.replace({ id: 6, title: 'Updatable Note', content: '', tags: 'newtag', parentId: 0 });
        expect(index.search('newtag', { fields: ['tags'] }).some(r => r.id === 6)).toBe(true);
        expect(index.search('oldtag', { fields: ['tags'] }).some(r => r.id === 6)).toBe(false);
    });

    it('should rank title matches higher than tag matches', () => {
        index.add({ id: 7, title: 'batman', content: '', tags: '', parentId: 0 });
        index.add({ id: 8, title: 'Some Note', content: '', tags: 'batman', parentId: 0 });
        const results = index.search('batman', { fields: ['title', 'content', 'tags'], boost: { title: 2, tags: 1.5 } });
        const titleMatch = results.find(r => r.id === 7);
        const tagMatch = results.find(r => r.id === 8);
        expect(titleMatch).toBeDefined();
        expect(tagMatch).toBeDefined();
        expect(titleMatch!.score).toBeGreaterThan(tagMatch!.score);
    });

    it('should support fuzzy search for typos', () => {
        index.add({ id: 9, title: 'Architecture', content: '', tags: '', parentId: 0 });
        const results = index.search('Architechure', { fuzzy: 0.3 });
        expect(results.some(r => r.id === 9)).toBe(true);
    });
});
