import type { StateCreator } from 'zustand';
import { KEYS } from '../../lib/constants';

export interface NotesSlice {
    selectedNoteId: number | null;
    setSelectedNoteId: (id: number | null) => void;
    // Explicitly stored path, allowing us to resurrect selections effectively
    selectedNotePath: string | null;
    setSelectedNotePath: (path: string | null) => void;

    // The folder that is currently active/open in the sidebar (used for context-aware creation)
    selectedFolderId: number | null;
    setSelectedFolderId: (id: number | null) => void;

    selectedTag: string | null;
    setSelectedTag: (tag: string | null) => void;
}

export const createNotesSlice: StateCreator<NotesSlice> = (set) => ({
    selectedNoteId: (() => {
        const savedId = localStorage.getItem('keim_selected_note_id');
        return savedId ? parseInt(savedId, 10) : null;
    })(),
    setSelectedNoteId: (selectedNoteId) => {
        if (selectedNoteId !== null) {
            localStorage.setItem(KEYS.SELECTED_NOTE_ID, selectedNoteId.toString());
        } else {
            localStorage.removeItem(KEYS.SELECTED_NOTE_ID);
        }
        set({ selectedNoteId });
    },

    selectedNotePath: localStorage.getItem(KEYS.SELECTED_NOTE_PATH) || null,
    setSelectedNotePath: (selectedNotePath) => {
        if (selectedNotePath !== null) {
            localStorage.setItem(KEYS.SELECTED_NOTE_PATH, selectedNotePath);
        } else {
            localStorage.removeItem(KEYS.SELECTED_NOTE_PATH);
        }
        set({ selectedNotePath });
    },

    selectedFolderId: null,
    setSelectedFolderId: (selectedFolderId) => set({ selectedFolderId }),

    selectedTag: null,
    setSelectedTag: (selectedTag) => set({ selectedTag }),
});
