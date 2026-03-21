import type { StateCreator } from 'zustand';
import { KEYS } from '../../lib/constants';

export interface UiSlice {
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
    setSidebarOpen: (isOpen: boolean) => void;
    
    isSettingsOpen: boolean;
    setIsSettingsOpen: (isOpen: boolean) => void;
    
    settingsTab: 'general' | 'sync' | 'appearance';
    setSettingsTab: (tab: 'general' | 'sync' | 'appearance') => void;

    theme: 'light' | 'dark' | 'system';
    setTheme: (theme: 'light' | 'dark' | 'system') => void;

    smartPopupState: { isOpen: boolean; folderId?: number; folderTitle?: string };
    setSmartPopupState: (state: { isOpen: boolean; folderId?: number; folderTitle?: string }) => void;
}

export const createUiSlice: StateCreator<UiSlice> = (set) => ({
    isSidebarOpen: localStorage.getItem(KEYS.SIDEBAR_OPEN) === 'true',
    toggleSidebar: () => set((state: any) => {
        const newState = !state.isSidebarOpen;
        localStorage.setItem(KEYS.SIDEBAR_OPEN, newState.toString());
        return { isSidebarOpen: newState };
    }),
    setSidebarOpen: (isSidebarOpen) => {
        localStorage.setItem(KEYS.SIDEBAR_OPEN, isSidebarOpen.toString());
        set({ isSidebarOpen });
    },

    isSettingsOpen: false,
    setIsSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
    
    settingsTab: 'general',
    setSettingsTab: (settingsTab) => set({ settingsTab }),

    theme: (() => {
        const stored = localStorage.getItem(KEYS.THEME) as 'light' | 'dark' | 'system';
        return stored || 'system';
    })(),
    setTheme: (theme) => {
        localStorage.setItem(KEYS.THEME, theme);
        set({ theme });
    },

    smartPopupState: { isOpen: false },
    setSmartPopupState: (smartPopupState) => set({ smartPopupState }),
});
