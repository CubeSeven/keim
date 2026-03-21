import type { StateCreator } from 'zustand';
import type { SyncStatus } from '../../App';
import { KEYS } from '../../lib/constants';

export interface SyncSlice {
    syncStatus: SyncStatus;
    setSyncStatus: (status: SyncStatus) => void;
    
    lastSyncTime: number | null;
    setLastSyncTime: (time: number | null) => void;
    
    isPickingVault: boolean;
    setIsPickingVault: (isPicking: boolean) => void;
    
    isVaultLocked: boolean;
    setIsVaultLocked: (locked: boolean) => void;
}

export const createSyncSlice: StateCreator<SyncSlice> = (set) => ({
    syncStatus: 'disconnected',
    setSyncStatus: (syncStatus) => set({ syncStatus }),

    lastSyncTime: (() => {
        const time = Number(localStorage.getItem(KEYS.LAST_SYNC));
        return time || null;
    })(),
    setLastSyncTime: (lastSyncTime) => {
        if (lastSyncTime) {
            localStorage.setItem(KEYS.LAST_SYNC, lastSyncTime.toString());
        } else {
            localStorage.removeItem(KEYS.LAST_SYNC);
        }
        set({ lastSyncTime });
    },

    isPickingVault: false,
    setIsPickingVault: (isPickingVault) => set({ isPickingVault }),
    
    isVaultLocked: false,
    setIsVaultLocked: (isVaultLocked) => set({ isVaultLocked }),
});
