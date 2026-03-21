import type { StateCreator } from 'zustand';
import { KEYS } from '../../lib/constants';

export interface CryptoSlice {
    e2eeModalState: { isOpen: boolean; mode: 'setup' | 'unlock' };
    setE2eeModalState: (state: { isOpen: boolean; mode: 'setup' | 'unlock' }) => void;
    
    activeDEK: CryptoKey | null;
    setActiveDEK: (dek: CryptoKey | null) => void;
    
    isE2EESkipped: boolean;
    setIsE2EESkipped: (skipped: boolean) => void;
}

export const createCryptoSlice: StateCreator<CryptoSlice> = (set) => ({
    e2eeModalState: { isOpen: false, mode: 'setup' },
    setE2eeModalState: (e2eeModalState) => set({ e2eeModalState }),

    activeDEK: null,
    setActiveDEK: (activeDEK) => set({ activeDEK }),
    
    isE2EESkipped: localStorage.getItem(KEYS.E2EE_SKIPPED) === 'true',
    setIsE2EESkipped: (isE2EESkipped) => {
         localStorage.setItem(KEYS.E2EE_SKIPPED, isE2EESkipped.toString());
         set({ isE2EESkipped });
    },
});
