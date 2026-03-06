/**
 * vault.ts — File System Access API Layer
 * Provides Obsidian-style "vault" functionality using the browser's
 * File System Access API. Notes are stored as real .md files on disk.
 * Falls back gracefully on unsupported browsers (Firefox, Safari).
 */

// Key used to persist the vault directory handle in IndexedDB
const VAULT_IDB_KEY = 'keim_vault_handle';
const VAULT_MODE_LS_KEY = 'keim_storage_mode'; // 'vault' | 'indexeddb'

// --- Feature Detection ---

export function isFileSystemSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function getStorageMode(): 'vault' | 'indexeddb' | 'unset' {
    const stored = localStorage.getItem(VAULT_MODE_LS_KEY);
    if (stored === 'vault' || stored === 'indexeddb') return stored;
    return 'unset';
}

export function setStorageMode(mode: 'vault' | 'indexeddb') {
    localStorage.setItem(VAULT_MODE_LS_KEY, mode);
}

// --- Vault Handle Persistence (via IndexedDB directly) ---

function openHandleStore(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('KeimVaultMeta', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('handles');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveVaultHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await openHandleStore();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, VAULT_IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
    try {
        const db = await openHandleStore();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readonly');
            const req = tx.objectStore('handles').get(VAULT_IDB_KEY);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

export async function clearVaultHandle(): Promise<void> {
    const db = await openHandleStore();
    return new Promise((resolve) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete(VAULT_IDB_KEY);
        tx.oncomplete = () => resolve();
    });
}

// --- Vault Picker ---

let _vaultHandle: FileSystemDirectoryHandle | null = null;

export function getVaultHandle(): FileSystemDirectoryHandle | null {
    return _vaultHandle;
}

export async function openVaultPicker(): Promise<FileSystemDirectoryHandle | null> {
    if (!isFileSystemSupported()) return null;
    try {
        const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        _vaultHandle = handle;
        await saveVaultHandle(handle);
        setStorageMode('vault');
        return handle;
    } catch (e: any) {
        if (e.name === 'AbortError') return null; // User cancelled
        throw e;
    }
}

export async function restoreVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
    const handle = await loadVaultHandle();
    if (!handle) return null;
    try {
        // Re-request permission if needed
        const permission = await (handle as any).requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
            _vaultHandle = handle;
            return handle;
        }
        return null;
    } catch {
        return null;
    }
}

// --- Vault File Tree ---

export interface VaultNote {
    path: string;       // relative path from vault root, e.g. "Work/Meeting.md"
    title: string;      // filename without .md
    parentPath: string; // parent folder path, "" for root
    updatedAt: number;
}

export interface VaultFolder {
    path: string;
    name: string;
    parentPath: string;
}

export interface VaultTree {
    notes: VaultNote[];
    folders: VaultFolder[];
}

async function readDirRecursive(
    dirHandle: FileSystemDirectoryHandle,
    basePath: string,
    tree: VaultTree
): Promise<void> {
    for await (const [name, entry] of (dirHandle as any).entries()) {
        // Skip hidden files/folders (like .git, .DS_Store)
        if (name.startsWith('.')) continue;

        if (entry.kind === 'directory') {
            const folderPath = basePath ? `${basePath}/${name}` : name;
            tree.folders.push({ path: folderPath, name, parentPath: basePath });
            await readDirRecursive(entry as FileSystemDirectoryHandle, folderPath, tree);
        } else if (entry.kind === 'file' && name.endsWith('.md')) {
            const file = await (entry as FileSystemFileHandle).getFile();
            const notePath = basePath ? `${basePath}/${name}` : name;
            tree.notes.push({
                path: notePath,
                title: name.replace(/\.md$/, ''),
                parentPath: basePath,
                updatedAt: file.lastModified,
            });
        }
    }
}

export async function readVaultTree(): Promise<VaultTree | null> {
    if (!_vaultHandle) return null;
    const tree: VaultTree = { notes: [], folders: [] };
    await readDirRecursive(_vaultHandle, '', tree);
    return tree;
}

// --- Note Read/Write ---

export async function readNoteContent(notePath: string): Promise<string> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = notePath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: false });
    const file = await fileHandle.getFile();
    return file.text();
}

export async function writeNoteToVault(notePath: string, content: string): Promise<void> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = notePath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(content);
    await writable.close();
}

export async function deleteNoteFromVault(notePath: string): Promise<void> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = notePath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
    }
    await dir.removeEntry(parts[parts.length - 1]);
}

export async function createFolderInVault(folderPath: string): Promise<void> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = folderPath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
    }
}

/** Convert a note title + parent path to a file path */
export function notePathFromTitle(title: string, parentPath: string): string {
    const safeName = title.replace(/[<>:"/\\|?*]/g, '_') + '.md';
    return parentPath ? `${parentPath}/${safeName}` : safeName;
}

/** Get the vault name (top-level folder name) for display */
export function getVaultName(): string {
    return _vaultHandle?.name ?? 'Vault';
}
