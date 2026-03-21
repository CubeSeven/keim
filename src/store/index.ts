import { create } from 'zustand';
import { createAppSlice, type AppSlice } from './slices/appSlice';
import { createNotesSlice, type NotesSlice } from './slices/notesSlice';
import { createSyncSlice, type SyncSlice } from './slices/syncSlice';
import { createUiSlice, type UiSlice } from './slices/uiSlice';
import { createCryptoSlice, type CryptoSlice } from './slices/cryptoSlice';

export * from './slices/appSlice';
export * from './slices/notesSlice';
export * from './slices/syncSlice';
export * from './slices/uiSlice';
export * from './slices/cryptoSlice';

export type DefaultAppState = AppSlice & NotesSlice & SyncSlice & UiSlice & CryptoSlice;

export const useAppStore = create<DefaultAppState>((...a) => ({
    ...createAppSlice(...a),
    ...createNotesSlice(...a),
    ...createSyncSlice(...a),
    ...createUiSlice(...a),
    ...createCryptoSlice(...a),
}));
