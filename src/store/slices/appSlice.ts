import type { StateCreator } from 'zustand';

export type AppStateStatus = 'loading' | 'welcome' | 'restore-vault' | 'needs-vault-permission' | 'ready';

export interface AppSlice {
    appState: AppStateStatus;
    setAppState: (state: AppStateStatus) => void;
}

export const createAppSlice: StateCreator<AppSlice> = (set) => ({
    appState: 'loading',
    setAppState: (appState) => set({ appState }),
});
