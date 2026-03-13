/**
 * smartProps.ts — Smart Properties Utility Library
 * 
 * Provides:
 * 1. YAML Frontmatter parsing/serialisation (pure JS, zero deps)
 * 2. Schema CRUD (IndexedDB via Dexie + optional vault sidecar)
 */

import { db, type SmartSchema, type SmartField } from './db';
import { getStorageMode, writeNoteToVault, deleteFromVault } from './vault';

// ---------------------------------------------------------------------------
// 1.  YAML Frontmatter helpers
// ---------------------------------------------------------------------------

export interface ParsedFrontmatter {
    /** Key/value pairs extracted from the YAML block */
    meta: Record<string, string>;
    /** Everything after the closing `---`, with leading newline trimmed */
    body: string;
}

/**
 * Parse a simple single-level YAML frontmatter block.
 * Only handles `key: value` lines (string values). 
 * Colon in value is preserved — only the FIRST colon on each line is treated as separator.
 */
export function parseYamlFrontmatter(content: string): ParsedFrontmatter {
    const empty: ParsedFrontmatter = { meta: {}, body: content };
    // Match exactly: starts with ---, then non-edy content, then ---
    const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
    if (!match) return empty;

    const yamlBlock = match[1];
    const body = match[2];

    const meta: Record<string, string> = {};
    for (const line of yamlBlock.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key) meta[key] = value;
    }

    return { meta, body };
}

/**
 * Serialise a meta record + body back to a string with YAML frontmatter.
 * If meta is empty, returns the body unchanged (no frontmatter block).
 */
export function serializeYamlFrontmatter(meta: Record<string, string>, body: string): string {
    if (Object.keys(meta).length === 0) return body;
    const yamlLines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n');
    return `---\n${yamlLines}\n---\n${body}`;
}

/**
 * Update a set of field values in a note's YAML frontmatter.
 * Other existing frontmatter keys are preserved.
 */
export function updateFrontmatterFields(
    content: string,
    updates: Record<string, string>
): string {
    const { meta, body } = parseYamlFrontmatter(content);
    const newMeta = { ...meta, ...updates };
    return serializeYamlFrontmatter(newMeta, body);
}

// ---------------------------------------------------------------------------
// 2.  Schema sidecar path helper
// ---------------------------------------------------------------------------

/**
 * Build the vault-relative path for a folder's schema sidecar.
 * e.g. "Clients" → "Clients/.keim-schema.json"
 */
function schemaPath(folderVaultPath: string): string {
    return folderVaultPath ? `${folderVaultPath}/.keim-schema.json` : '.keim-schema.json';
}

// ---------------------------------------------------------------------------
// 3.  Schema CRUD
// ---------------------------------------------------------------------------

/** Read the schema for a given folder ID. Returns null if none exists. */
export async function readSchema(folderId: number): Promise<SmartSchema | null> {
    const schema = await db.smartSchemas.where({ folderId }).first();
    return schema ?? null;
}

/**
 * Upsert a schema for a folder.
 * In vault mode also writes a `.keim-schema.json` sidecar file.
 */
export async function writeSchema(
    folderId: number,
    fields: SmartField[],
    folderVaultPath?: string
): Promise<void> {
    const existing = await db.smartSchemas.where({ folderId }).first();
    if (existing?.id !== undefined) {
        await db.smartSchemas.update(existing.id, { fields });
    } else {
        await db.smartSchemas.add({ folderId, fields });
    }

    // Bump the folder's updated_at timestamp so that the sync engine knows it changed
    await db.items.update(folderId, { updated_at: Date.now() });

    // Persist sidecar to vault if enabled
    if (getStorageMode() === 'vault' && folderVaultPath !== undefined) {
        try {
            const json = JSON.stringify({ version: 1, fields }, null, 2);
            await writeNoteToVault(schemaPath(folderVaultPath), json);
        } catch (e) {
            console.warn('smartProps: could not write sidecar to vault', e);
        }
    }
}

/**
 * Delete the schema for a folder, removing both the DB record and vault sidecar.
 */
export async function deleteSchema(
    folderId: number,
    folderVaultPath?: string
): Promise<void> {
    await db.smartSchemas.where({ folderId }).delete();

    if (getStorageMode() === 'vault' && folderVaultPath !== undefined) {
        try {
            await deleteFromVault(schemaPath(folderVaultPath));
        } catch {
            // Already gone — that's fine
        }
    }
}
