import { describe, it, expect } from 'vitest';
import { parseYamlFrontmatter, serializeYamlFrontmatter, updateFrontmatterFields } from '../lib/smartProps';

describe('Smart Properties - YAML Frontmatter Engine', () => {

    it('should return empty meta for content without frontmatter', () => {
        const content = 'Just some text\nwith newlines.';
        const result = parseYamlFrontmatter(content);
        expect(result.meta).toEqual({});
        expect(result.body).toBe(content);
    });

    it('should parse simple frontmatter correctly', () => {
        const content = '---\nStatus: In Progress\nPriority: High\n---\n# Note Content\nHello';
        const result = parseYamlFrontmatter(content);
        expect(result.meta).toEqual({
            Status: 'In Progress',
            Priority: 'High'
        });
        expect(result.body).toBe('# Note Content\nHello');
    });

    it('should handle colons in the value', () => {
        const content = '---\nURL: https://example.com\nTime: 12:00 PM\n---\nBody text';
        const result = parseYamlFrontmatter(content);
        expect(result.meta).toEqual({
            URL: 'https://example.com',
            Time: '12:00 PM'
        });
    });

    it('should handle empty fields', () => {
        const content = '---\nName: \nNotes:\n---\nbody';
        const result = parseYamlFrontmatter(content);
        expect(result.meta).toEqual({
            Name: '',
            Notes: ''
        });
        expect(result.body).toBe('body');
    });

    it('should serialize correctly', () => {
        const meta = { Name: 'Alice', Age: '30' };
        const body = 'Body content';
        const result = serializeYamlFrontmatter(meta, body);
        expect(result).toBe('---\nName: Alice\nAge: 30\n---\nBody content');
    });

    it('should serialize without frontmatter if meta is empty', () => {
        const meta = {};
        const body = 'Just text';
        const result = serializeYamlFrontmatter(meta, body);
        expect(result).toBe('Just text');
    });

    it('should update frontmatter fields while preserving body', () => {
        const content = '---\nName: Alice\nScore: 10\n---\nBody here';
        const updated = updateFrontmatterFields(content, { Score: '20', NewField: 'Yes' });
        expect(updated).toBe('---\nName: Alice\nScore: 20\nNewField: Yes\n---\nBody here');
    });

    it('should add frontmatter to a plain document via updateFrontmatterFields', () => {
        const content = '# Hello World\nSome text.';
        const updated = updateFrontmatterFields(content, { Client: 'Acme' });
        expect(updated).toBe('---\nClient: Acme\n---\n# Hello World\nSome text.');
    });

});
