/**
 * src/lib/constants.ts
 * Centralized localStorage key constants.
 * Use these instead of inline string literals to prevent silent typo bugs.
 */

export const KEYS = {
    // Note / Sidebar selection
    SELECTED_NOTE_ID:   'keim_selected_note_id',
    SELECTED_NOTE_PATH: 'keim_selected_note_path',

    // Sync
    LAST_SYNC:          'keim_last_sync',

    // Onboarding
    HAS_USER_EDITS:     'keim_has_user_edits',
    SEEDED_V2:          'notes_seeded_v2',

    // UI state
    SIDEBAR_OPEN:       'keim_sidebar_open',
    THEME:              'keim_theme',

    // Storage
    STORAGE_MODE:       'keim_storage_mode',

    // E2EE
    E2EE_SKIPPED:       'keim_e2ee_skipped',
    ACTIVE_DEK:         'keim_active_dek',
    BIO_CREDENTIAL:     'keim_bio_credential',
} as const;
