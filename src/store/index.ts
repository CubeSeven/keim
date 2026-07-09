import { create } from 'zustand';
import { createAppSlice, type AppSlice } from './slices/appSlice';
import { createNotesSlice, type NotesSlice } from './slices/notesSlice';
import { createUiSlice, type UiSlice } from './slices/uiSlice';

export * from './slices/appSlice';
export * from './slices/notesSlice';
export * from './slices/uiSlice';

export type DefaultAppState = AppSlice & NotesSlice & UiSlice;

export const useAppStore = create<DefaultAppState>((...a) => ({
    ...createAppSlice(...a),
    ...createNotesSlice(...a),
    ...createUiSlice(...a),
}));
