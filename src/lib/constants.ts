/**
 * src/lib/constants.ts
 * Centralized localStorage key constants.
 */

export const KEYS = {
    SELECTED_NOTE_PATH: 'keim_selected_note_path',
    SIDEBAR_OPEN:       'keim_sidebar_open',
    THEME:              'keim_theme',
    STORAGE_MODE:       'keim_storage_mode',
} as const;

// App version (shown in settings)
export const APP_VERSION = '2.0.0';
