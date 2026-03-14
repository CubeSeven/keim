import { useEffect } from 'react';

interface KeyboardShortcutsProps {
    handleAddNote: () => void;
    handleAddFolder: () => void;
    doSync: () => void;
    selectedNoteId: number | null;
}

export function useKeyboardShortcuts({ handleAddNote, handleAddFolder, doSync, selectedNoteId }: KeyboardShortcutsProps) {
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.altKey) {
                if (e.code === 'KeyN') {
                    e.preventDefault();
                    handleAddNote();
                } else if (e.code === 'KeyF') {
                    e.preventDefault();
                    handleAddFolder();
                } else if (e.code === 'KeyS') {
                    e.preventDefault();
                    doSync();
                } else if (e.code === 'KeyD') {
                    e.preventDefault();
                    if (selectedNoteId) {
                        window.dispatchEvent(new CustomEvent('keim_prepare_delete', { detail: selectedNoteId }));
                    }
                }
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [doSync, selectedNoteId, handleAddNote, handleAddFolder]);
}
