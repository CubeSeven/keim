import { create } from 'zustand';
import type { SyncStatus } from '../App'; // Will move types later, but for now referencing existing

export type AppStateStatus = 'loading' | 'welcome' | 'restore-vault' | 'needs-vault-permission' | 'ready';

interface DefaultAppState {
    // -------------------------------------------------------------
    // Core Application State
    // -------------------------------------------------------------
    appState: AppStateStatus;
    setAppState: (state: AppStateStatus) => void;

    // -------------------------------------------------------------
    // Note Management
    // -------------------------------------------------------------
    selectedNoteId: number | null;
    setSelectedNoteId: (id: number | null) => void;
    // Explicitly stored path, allowing us to resurrect selections effectively
    selectedNotePath: string | null;
    setSelectedNotePath: (path: string | null) => void;

    // -------------------------------------------------------------
    // Sync & Storage State
    // -------------------------------------------------------------
    syncStatus: SyncStatus;
    setSyncStatus: (status: SyncStatus) => void;
    lastSyncTime: number | null;
    setLastSyncTime: (time: number | null) => void;
    
    isPickingVault: boolean;
    setIsPickingVault: (isPicking: boolean) => void;
    isVaultLocked: boolean;
    setIsVaultLocked: (locked: boolean) => void;

    // -------------------------------------------------------------
    // UI layout State
    // -------------------------------------------------------------
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

export const useAppStore = create<DefaultAppState>((set) => ({
    appState: 'loading',
    setAppState: (appState) => set({ appState }),

    selectedNoteId: (() => {
        const savedId = localStorage.getItem('keim_selected_note_id');
        return savedId ? parseInt(savedId, 10) : null;
    })(),
    setSelectedNoteId: (selectedNoteId) => {
        if (selectedNoteId !== null) {
            localStorage.setItem('keim_selected_note_id', selectedNoteId.toString());
        } else {
            localStorage.removeItem('keim_selected_note_id');
        }
        set({ selectedNoteId });
    },

    selectedNotePath: localStorage.getItem('keim_selected_note_path') || null,
    setSelectedNotePath: (selectedNotePath) => {
        if (selectedNotePath !== null) {
            localStorage.setItem('keim_selected_note_path', selectedNotePath);
        } else {
            localStorage.removeItem('keim_selected_note_path');
        }
        set({ selectedNotePath });
    },

    syncStatus: 'disconnected',
    setSyncStatus: (syncStatus) => set({ syncStatus }),

    lastSyncTime: (() => {
        const time = Number(localStorage.getItem('keim_last_sync'));
        return time || null;
    })(),
    setLastSyncTime: (lastSyncTime) => {
        if (lastSyncTime) localStorage.setItem('keim_last_sync', lastSyncTime.toString());
        set({ lastSyncTime });
    },

    isPickingVault: false,
    setIsPickingVault: (isPickingVault) => set({ isPickingVault }),
    
    isVaultLocked: false,
    setIsVaultLocked: (isVaultLocked) => set({ isVaultLocked }),

    isSidebarOpen: localStorage.getItem('keim_sidebar_open') === 'true',
    toggleSidebar: () => set((state) => {
        const newState = !state.isSidebarOpen;
        localStorage.setItem('keim_sidebar_open', newState.toString());
        return { isSidebarOpen: newState };
    }),
    setSidebarOpen: (isSidebarOpen) => {
        localStorage.setItem('keim_sidebar_open', isSidebarOpen.toString());
        set({ isSidebarOpen });
    },

    isSettingsOpen: false,
    setIsSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
    
    settingsTab: 'general',
    setSettingsTab: (settingsTab) => set({ settingsTab }),

    theme: (() => {
        const stored = localStorage.getItem('keim_theme') as 'light' | 'dark' | 'system';
        return stored || 'system';
    })(),
    setTheme: (theme) => {
        localStorage.setItem('keim_theme', theme);
        set({ theme });
    },

    smartPopupState: { isOpen: false },
    setSmartPopupState: (smartPopupState) => set({ smartPopupState }),
}));
