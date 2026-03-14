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
    if (typeof window === 'undefined') return false;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) return false;
    return 'showDirectoryPicker' in window;
}

export function getStorageMode(): 'vault' | 'indexeddb' | 'unset' {
    const stored = localStorage.getItem(VAULT_MODE_LS_KEY);
    if (stored === 'vault' || stored === 'indexeddb') return stored;
    return 'unset';
}

export function setStorageMode(mode: 'vault' | 'indexeddb' | 'unset') {
    if (mode === 'unset') {
        localStorage.removeItem(VAULT_MODE_LS_KEY);
    } else {
        localStorage.setItem(VAULT_MODE_LS_KEY, mode);
    }
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

async function saveVaultHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await openHandleStore();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, VAULT_IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function loadVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
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

export async function hasSavedVault(): Promise<boolean> {
    const handle = await loadVaultHandle();
    return !!handle;
}

// --- Vault Picker ---

let _vaultHandle: FileSystemDirectoryHandle | null = null;

export async function openVaultPicker(): Promise<FileSystemDirectoryHandle | null> {
    if (!isFileSystemSupported()) return null;
    try {
        const handle = await (window as unknown as { showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' });
        _vaultHandle = handle;
        await saveVaultHandle(handle);
        setStorageMode('vault');
        return handle;
    } catch (e) {
        if ((e as Error).name === 'AbortError') return null; // User cancelled
        throw e;
    }
}

export async function restoreVaultHandle(requestPermissionIfPrompt = false): Promise<FileSystemDirectoryHandle | null> {
    const handle = await loadVaultHandle();
    if (!handle) return null;
    try {
        // Using any since TypeScript types for FileSystemHandle are sometimes incomplete
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handleAny = handle as any;

        // 1. Check current permission silently
        let permission = await handleAny.queryPermission({ mode: 'readwrite' });

        // 2. Request permission if needed AND we are allowed to prompt (must be called from user gesture)
        if (permission === 'prompt' && requestPermissionIfPrompt) {
            permission = await handleAny.requestPermission({ mode: 'readwrite' });
        }

        if (permission === 'granted') {
            _vaultHandle = handle;
            return handle;
        }
        return null;
    } catch (e) {
        console.warn('Failed to restore vault handle', e);
        return null;
    }
}

// --- Vault File Tree ---

interface VaultNote {
    path: string;       // relative path from vault root, e.g. "Work/Meeting.md"
    title: string;      // filename without .md
    parentPath: string; // parent folder path, "" for root
    updatedAt: number;
}

interface VaultFolder {
    path: string;
    name: string;
    parentPath: string;
}

interface VaultTree {
    notes: VaultNote[];
    folders: VaultFolder[];
}

async function readDirRecursive(
    dirHandle: FileSystemDirectoryHandle,
    basePath: string,
    tree: VaultTree
): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writable = await (fileHandle as any).createWritable();
    await writable.write(content);
    await writable.close();
}

/**
 * Delete any file or folder from the vault by its relative path.
 * For folders, deletion is recursive (removes all children).
 */
export async function deleteFromVault(relativePath: string): Promise<void> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = relativePath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    try {
        for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i], { create: false });
        }
        await dir.removeEntry(parts[parts.length - 1], { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
        // If it's already gone (NotFoundError) or we can't find the parent, 
        // that's fine, the goal of deletion is met.
        if (e.name === 'NotFoundError') {
            return;
        }
        throw e;
    }
}

/** Convert a note title + parent path to a file path */
export function notePathFromTitle(title: string, parentPath: string): string {
    const safeName = title.replace(/[<>:"/\\|?*]/g, '_') + '.md';
    return parentPath ? `${parentPath}/${safeName}` : safeName;
}



/** Get the current in-memory vault handle (may be null if vault is locked) */
export function getVaultHandle(): FileSystemDirectoryHandle | null {
    return _vaultHandle;
}

/** Create a directory recursively in the vault */
export async function createFolderInVault(folderPath: string): Promise<void> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = folderPath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    for (const part of parts) {
        if (part) dir = await dir.getDirectoryHandle(part, { create: true });
    }
}

/** 
 * Helper to physically move a folder and all its contents in the vault.
 * Since the FSA API doesn't support folder renaming, we must:
 * 1. Create the new folder path
 * 2. Find all notes inside the old folder from the DB
 * 3. Rewrite them to the new paths
 * 4. Delete the old folder
 */
export async function moveVaultFolder(
    oldFolderPath: string,
    newFolderPath: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allDbItems: any[], // using any to avoid direct circular dep on db.ts types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allDbContents: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getItemPath: (id: number, items: any[]) => string
): Promise<void> {
    if (!_vaultHandle) return;
    if (oldFolderPath === newFolderPath) return;

    // 1. Ensure the new directory exists
    await createFolderInVault(newFolderPath);

    // 2. Find all notes that are descendants of this folder (path starts with oldFolderPath)
    const descendantNotes = allDbItems.filter(item => {
        if (item.type !== 'note' || item.isDeleted) return false;
        const parentPath = getItemPath(item.parentId, allDbItems);
        return parentPath === oldFolderPath || parentPath.startsWith(oldFolderPath + '/');
    });

    const contentMap = new Map(allDbContents.map(c => [c.id, c.content]));

    // 3. Rewrite all notes to their new paths
    for (const note of descendantNotes) {
        const oldNoteParentPath = getItemPath(note.parentId, allDbItems);
        // Replace the prefix
        const newNoteParentPath = oldFolderPath === oldNoteParentPath 
            ? newFolderPath 
            : newFolderPath + oldNoteParentPath.substring(oldFolderPath.length);
        
        const newNotePath = notePathFromTitle(note.title, newNoteParentPath);
        const content = contentMap.get(note.id) || '';
        
        await writeNoteToVault(newNotePath, content);
    }

    // 4. Delete the old folder recursively
    try {
        await deleteFromVault(oldFolderPath);
    } catch (e) {
        console.warn(`Failed to delete old folder after move: ${oldFolderPath}`, e);
        // Fallback: If removeEntry fails (e.g., due to hidden OS files), 
        // the reconciliation step will eventually clean it up anyway now that
        // we fixed getFullPath in expectedFolderPaths.
    }
}

/**
 * Robustly reconciles the physical vault disk to match the DB state.
 * This is the 'Source of Truth' enforcer.
 */
export async function reconcileVault(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allDbItems: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allDbContents: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getItemPath: (id: number, items: any[]) => string,
    targetItemIds?: number[] // Optional: only reconcile these specific items
): Promise<void> {
    if (!_vaultHandle) return;

    // 1. Get current physical state
    const physicalTree = await readVaultTree();
    if (!physicalTree) return;

    const contentMap = new Map<number, string>(allDbContents.map(c => [c.id, c.content]));

    // 2. Identify all expected paths from DB
    const expectedPaths = new Set<string>();
    const expectedNotePaths = new Map<string, number>(); // path -> id
    const expectedFolderPaths = new Set<string>();

    for (const item of allDbItems) {
        if (item.isDeleted) continue;
        
        if (item.type === 'note') {
            const parentPath = getItemPath(item.parentId, allDbItems);
            const fullPath = notePathFromTitle(item.title, parentPath);
            expectedPaths.add(fullPath);
            expectedNotePaths.set(fullPath, item.id!);
        } else {
            const fullPath = getItemPath(item.id!, allDbItems);
            expectedPaths.add(fullPath);
            expectedFolderPaths.add(fullPath);
        }
    }

    // 3. Cleanup: Delete physical items NOT in expectedPaths
    // Skip cleanup if we're only reconciling specific items (incremental mode)
    if (!targetItemIds) {
        const physicalFolders = [...physicalTree.folders].sort((a, b) => b.path.length - a.path.length);
        for (const pf of physicalFolders) {
            if (!expectedFolderPaths.has(pf.path)) {
                try { await deleteFromVault(pf.path); } catch { /* ignore */ }
            }
        }
        for (const pn of physicalTree.notes) {
            if (!expectedNotePaths.has(pn.path)) {
                try { await deleteFromVault(pn.path); } catch { /* ignore */ }
            }
        }
    }

    // 4. Create/Update physical items from DB
    const targetSet = targetItemIds ? new Set(targetItemIds) : null;

    // Folders
    const dbFolders = allDbItems.filter(i => i.type === 'folder' && !i.isDeleted && (!targetSet || targetSet.has(i.id!)))
        .sort((a, b) => getItemPath(a.id!, allDbItems).length - getItemPath(b.id!, allDbItems).length);
    
    for (const df of dbFolders) {
        const fullPath = getItemPath(df.id!, allDbItems);
        await createFolderInVault(fullPath);
    }

    // Notes
    const dbNotes = allDbItems.filter(i => i.type === 'note' && !i.isDeleted && (!targetSet || targetSet.has(i.id!)));
    for (const dn of dbNotes) {
        const parentPath = getItemPath(dn.parentId, allDbItems);
        const fullPath = notePathFromTitle(dn.title, parentPath);
        const content = contentMap.get(dn.id!) || '';
        
        const physicalNote = physicalTree.notes.find(pn => pn.path === fullPath);
        
        if (!physicalNote) {
            await writeNoteToVault(fullPath, content);
        } else {
            // Efficiency: Compare DB updated_at with Disk lastModified.
            // Note: Disk precision might be lower (seconds vs ms), so we allow a small drift (1000ms).
            const diskModified = physicalNote.updatedAt;
            const dbUpdated = dn.updated_at;

            // If disk is older than DB, OR if DB is significantly newer (sync), overwrite.
            // If timestamps match closely, skip the expensive content read.
            if (Math.abs(diskModified - dbUpdated) > 2000) {
                const currentContent = await readNoteContent(fullPath).catch(() => null);
                if (currentContent !== content) {
                    await writeNoteToVault(fullPath, content);
                }
            }
        }
    }
}
