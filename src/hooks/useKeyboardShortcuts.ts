import { useEffect } from 'react';

interface KeyboardShortcutsProps {
    handleAddNote: () => void;
    handleAddFolder: () => void;
    selectedNotePath: string | null;
}

export function useKeyboardShortcuts({ handleAddNote, handleAddFolder, selectedNotePath }: KeyboardShortcutsProps) {
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.altKey) {
                if (e.code === 'KeyN') {
                    e.preventDefault();
                    handleAddNote();
                } else if (e.code === 'KeyF') {
                    e.preventDefault();
                    handleAddFolder();
                } else if (e.code === 'KeyD') {
                    e.preventDefault();
                    if (selectedNotePath) {
                        window.dispatchEvent(new CustomEvent('keim_prepare_delete', { detail: selectedNotePath }));
                    }
                }
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [selectedNotePath, handleAddNote, handleAddFolder]);
}
