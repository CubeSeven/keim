/**
 * Tests for the NavigationDock component.
 * Verifies that clicking each action button fires the correct callback.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NavigationDock from '../components/NavigationDock';

describe('NavigationDock Component', () => {
    it('calls onAddNote when the New Note button is clicked', () => {
        const onAddNote = vi.fn();
        const onAddFolder = vi.fn();
        render(<NavigationDock onAddNote={onAddNote} onAddFolder={onAddFolder} isSidebarOpen={false} />);

        const newNoteBtn = screen.getByTitle('New Note (Alt+N)');
        fireEvent.click(newNoteBtn);
        expect(onAddNote).toHaveBeenCalledTimes(1);
        expect(onAddFolder).not.toHaveBeenCalled();
    });

    it('calls onAddFolder when the New Folder button is clicked', () => {
        const onAddNote = vi.fn();
        const onAddFolder = vi.fn();
        render(<NavigationDock onAddNote={onAddNote} onAddFolder={onAddFolder} isSidebarOpen={false} />);

        const newFolderBtn = screen.getByTitle('New Folder (Alt+F)');
        fireEvent.click(newFolderBtn);
        expect(onAddFolder).toHaveBeenCalledTimes(1);
        expect(onAddNote).not.toHaveBeenCalled();
    });

    it('dispatches a Alt+K keyboard event when the Search button is clicked', () => {
        const onAddNote = vi.fn();
        const onAddFolder = vi.fn();
        render(<NavigationDock onAddNote={onAddNote} onAddFolder={onAddFolder} isSidebarOpen={false} />);

        const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
        const searchBtn = screen.getByTitle('Search Notes (Alt+K)');
        fireEvent.click(searchBtn);
        expect(dispatchSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'keydown', code: 'KeyK', altKey: true })
        );
    });
});
