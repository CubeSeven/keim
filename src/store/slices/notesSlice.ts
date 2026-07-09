import type { StateCreator } from 'zustand';
import type { VaultTree } from '../../lib/vault';
import { buildWikiIndex } from '../../lib/wikilinks';
import { KEYS } from '../../lib/constants';

export interface NotesSlice {
    // In-memory mirror of the vault folder (source of truth is disk)
    tree: VaultTree;
    setTree: (tree: VaultTree) => void;

    // title -> note path index (for wikilinks)
    wikiIndex: Map<string, string>;

    // Currently open note (identified by its .md path)
    selectedNotePath: string | null;
    setSelectedNotePath: (path: string | null) => void;

    // Folder context for creating new notes
    selectedFolderPath: string | null;
    setSelectedFolderPath: (path: string | null) => void;

    // Local save status (drives the sidebar footer indicator)
    saving: boolean;
    setSaving: (saving: boolean) => void;
    lastSavedTime: number | null;
    setLastSavedTime: (t: number | null) => void;
}

export const createNotesSlice: StateCreator<NotesSlice> = (set) => ({
    tree: { notes: [], folders: [] },
    setTree: (tree) => set({ tree, wikiIndex: buildWikiIndex(tree) }),

    wikiIndex: new Map(),

    selectedNotePath: localStorage.getItem(KEYS.SELECTED_NOTE_PATH) || null,
    setSelectedNotePath: (selectedNotePath) => {
        if (selectedNotePath !== null) {
            localStorage.setItem(KEYS.SELECTED_NOTE_PATH, selectedNotePath);
        } else {
            localStorage.removeItem(KEYS.SELECTED_NOTE_PATH);
        }
        set({ selectedNotePath });
    },

    selectedFolderPath: null,
    setSelectedFolderPath: (selectedFolderPath) => set({ selectedFolderPath }),

    saving: false,
    setSaving: (saving) => set({ saving }),
    lastSavedTime: null,
    setLastSavedTime: (lastSavedTime) => set({ lastSavedTime }),
});
