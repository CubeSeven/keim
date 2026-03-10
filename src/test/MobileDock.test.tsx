/**
 * Tests for the MobileDock component.
 * Verifies that clicking each action button fires the correct callback.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileDock } from '../components/MobileDock';

describe('MobileDock Component', () => {
    it('calls onAddNote when the New Note button is clicked', () => {
        const onAddNote = vi.fn();
        const onAddFolder = vi.fn();
        render(<MobileDock onAddNote={onAddNote} onAddFolder={onAddFolder} />);

        const newNoteBtn = screen.getByTitle('New Note');
        fireEvent.click(newNoteBtn);
        expect(onAddNote).toHaveBeenCalledTimes(1);
        expect(onAddFolder).not.toHaveBeenCalled();
    });

    it('calls onAddFolder when the New Folder button is clicked', () => {
        const onAddNote = vi.fn();
        const onAddFolder = vi.fn();
        render(<MobileDock onAddNote={onAddNote} onAddFolder={onAddFolder} />);

        const newFolderBtn = screen.getByTitle('New Folder');
        fireEvent.click(newFolderBtn);
        expect(onAddFolder).toHaveBeenCalledTimes(1);
        expect(onAddNote).not.toHaveBeenCalled();
    });

    it('dispatches a Ctrl+K keyboard event when the Search button is clicked', () => {
        const onAddNote = vi.fn();
        const onAddFolder = vi.fn();
        render(<MobileDock onAddNote={onAddNote} onAddFolder={onAddFolder} />);

        const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
        const searchBtn = screen.getByTitle('Search Notes');
        fireEvent.click(searchBtn);
        expect(dispatchSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'keydown', key: 'k', ctrlKey: true })
        );
    });
});
