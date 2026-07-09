/**
 * vault.ts — File System Access API Layer (single source of truth)
 *
 * Keim is vault-only: notes live as real `.md` files in a folder the user
 * picks on launch. There is NO database — the disk folder is the store.
 * A tiny raw IndexedDB key is used ONLY to persist the folder permission
 * handle (required by the File System Access API); it never holds notes.
 */

// Key used to persist the vault directory handle (NOT note data)
const VAULT_IDB_KEY = 'keim_vault_handle';
const VAULT_MODE_LS_KEY = 'keim_storage_mode'; // 'vault' | 'unset'

// --- FSA API Type Extensions ---
interface FileSystemHandleExt extends FileSystemFileHandle {
    queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    entries(): AsyncIterable<[string, FileSystemHandle]>;
}
interface FSAWritableStream {
    write(data: string | ArrayBuffer | Blob): Promise<void>;
    close(): Promise<void>;
}
interface FileSystemFileHandleWritable {
    createWritable(): Promise<FSAWritableStream>;
}

// --- Data Model ---
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

// --- Feature Detection ---
export function isFileSystemSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) return false;
    return 'showDirectoryPicker' in window;
}

export function getStorageMode(): 'vault' | 'unset' {
    const stored = localStorage.getItem(VAULT_MODE_LS_KEY);
    return stored === 'vault' ? 'vault' : 'unset';
}
export function setStorageMode(mode: 'vault' | 'unset') {
    if (mode === 'unset') localStorage.removeItem(VAULT_MODE_LS_KEY);
    else localStorage.setItem(VAULT_MODE_LS_KEY, mode);
}

// --- Vault Handle Persistence (raw IndexedDB — handle only) ---
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
        const handleExt = handle as unknown as FileSystemHandleExt;
        let permission = await handleExt.queryPermission({ mode: 'readwrite' });
        if (permission === 'prompt' && requestPermissionIfPrompt) {
            permission = await handleExt.requestPermission({ mode: 'readwrite' });
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

// --- Path helpers ---
export function parentPathOf(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx === -1 ? '' : path.slice(0, idx);
}
export function nameFromPath(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx === -1 ? path : path.slice(idx + 1);
}
export function titleFromNotePath(path: string): string {
    const name = nameFromPath(path);
    return name.replace(/\.md$/, '');
}
export function notePathFromTitle(title: string, parentPath: string): string {
    const safeName = title.replace(/[<>:"/\\|?*]/g, '_').replace(/\.md$/, '') + '.md';
    return parentPath ? `${parentPath}/${safeName}` : safeName;
}
export function folderPathFromName(name: string, parentPath: string): string {
    const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
    return parentPath ? `${parentPath}/${safeName}` : safeName;
}

// --- Tree reading ---
async function readDirRecursive(
    dirHandle: FileSystemDirectoryHandle,
    basePath: string,
    tree: VaultTree
): Promise<void> {
    for await (const [name, entry] of (dirHandle as unknown as FileSystemHandleExt).entries()) {
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

export async function reloadTree(): Promise<VaultTree> {
    const tree = await readVaultTree();
    return tree ?? { notes: [], folders: [] };
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
    const writable = await (fileHandle as unknown as FileSystemFileHandleWritable).createWritable();
    await writable.write(content);
    await writable.close();
}

export async function deleteFromVault(relativePath: string): Promise<void> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = relativePath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    try {
        for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i], { create: false });
        }
        await dir.removeEntry(parts[parts.length - 1], { recursive: true });
    } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'NotFoundError') return;
        throw e;
    }
}

export async function createFolderInVault(folderPath: string): Promise<void> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = folderPath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    for (const part of parts) {
        if (part) dir = await dir.getDirectoryHandle(part, { create: true });
    }
}

// --- CRUD helpers used by the UI ---
export async function createNote(parentPath: string, title: string): Promise<string> {
    const notePath = notePathFromTitle(title, parentPath);
    await writeNoteToVault(notePath, '');
    return notePath;
}
export async function createFolder(parentPath: string, name: string): Promise<string> {
    const folderPath = folderPathFromName(name, parentPath);
    await createFolderInVault(folderPath);
    return folderPath;
}
export async function renameNote(oldNotePath: string, newTitle: string): Promise<string> {
    const content = await readNoteContent(oldNotePath);
    const newPath = notePathFromTitle(newTitle, parentPathOf(oldNotePath));
    if (newPath !== oldNotePath) {
        await writeNoteToVault(newPath, content);
        await deleteFromVault(oldNotePath);
    }
    return newPath;
}
export async function renameFolder(oldFolderPath: string, newName: string): Promise<string> {
    const newFolderPath = folderPathFromName(newName, parentPathOf(oldFolderPath));
    const tree = await reloadTree();
    // Re-create new folder
    await createFolderInVault(newFolderPath);
    // Move all descendant notes
    const descendants = tree.notes.filter((n: VaultNote) =>
        n.parentPath === oldFolderPath || n.parentPath.startsWith(oldFolderPath + '/')
    );
    for (const note of descendants) {
        const content = await readNoteContent(note.path);
        const relFromOld = note.parentPath.slice(oldFolderPath.length); // e.g. "/Sub" or ""
        const newParent = (newFolderPath + relFromOld).replace(/\/+$/, '');
        const newPath = notePathFromTitle(note.title, newParent);
        await writeNoteToVault(newPath, content);
    }
    // Delete old folder (recursive)
    await deleteFromVault(oldFolderPath);
    return newFolderPath;
}
export async function deleteNote(notePath: string): Promise<void> {
    await deleteFromVault(notePath);
}
export async function deleteFolder(folderPath: string): Promise<void> {
    await deleteFromVault(folderPath);
}

// --- Wikilink rewrite on rename ---
// Replace all [[oldTitle]] references across the vault with [[newTitle]].
export async function updateWikilinksOnRename(oldTitle: string, newTitle: string): Promise<void> {
    if (oldTitle === newTitle) return;
    const tree = await reloadTree();
    const escaped = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\[\\[\\s*${escaped}\\s*\\]\\]`, 'g');
    for (const note of tree.notes) {
        const content = await readNoteContent(note.path);
        const updated = content.replace(re, `[[${newTitle}]]`);
        if (updated !== content) {
            await writeNoteToVault(note.path, updated);
        }
    }
}

// --- Move (reparent) used by drag & drop ---
export async function moveNote(oldNotePath: string, newParentPath: string): Promise<string> {
    if (parentPathOf(oldNotePath) === newParentPath) return oldNotePath; // no-op
    const content = await readNoteContent(oldNotePath);
    const newPath = notePathFromTitle(titleFromNotePath(oldNotePath), newParentPath);
    if (newPath !== oldNotePath) {
        await writeNoteToVault(newPath, content);
        await deleteFromVault(oldNotePath);
    }
    return newPath;
}
export async function moveFolder(oldFolderPath: string, newParentPath: string): Promise<string> {
    if (parentPathOf(oldFolderPath) === newParentPath) return oldFolderPath; // no-op
    const newFolderPath = folderPathFromName(nameFromPath(oldFolderPath), newParentPath);
    const tree = await reloadTree();
    await createFolderInVault(newFolderPath);
    const descendants = tree.notes.filter((n: VaultNote) =>
        n.parentPath === oldFolderPath || n.parentPath.startsWith(oldFolderPath + '/')
    );
    for (const note of descendants) {
        const content = await readNoteContent(note.path);
        const relFromOld = note.parentPath.slice(oldFolderPath.length);
        const newParent = (newFolderPath + relFromOld).replace(/\/+$/, '');
        const newPath = notePathFromTitle(note.title, newParent);
        await writeNoteToVault(newPath, content);
    }
    await deleteFromVault(oldFolderPath);
    return newFolderPath;
}

export function getVaultHandle(): FileSystemDirectoryHandle | null {
    return _vaultHandle;
}
