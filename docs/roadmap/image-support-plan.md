# Image Support Implementation Plan

Keim Notes currently only supports text-based data (Markdown and JSON metadata). Binary assets like images are not stored in the database, tracked by the sync engine, or managed within the local vault.

## Current Limitations

- **Database**: The `NotesDatabase` lacks an `assets` table to store image data.
- **Vault**: The vault logic strictly filters for `.md` files and ignores images.
- **Sync**: The Dropbox sync engine only processes `items`, `contents`, and `schemas`.
- **Editor**: Milkdown/Crepe is not configured with an image upload handler.

## Proposed Changes

### [Database]
#### [MODIFY] [db.ts](file:///Users/panos/Documents/keim%20notes/src/lib/db.ts)
- Add an `assets` table to store binary data (Blobs) or Base64 strings indexed by a unique ID.
- Define a relationship between notes and their assets (or a global asset store).

### [Vault & Sync]
#### [MODIFY] [vault.ts](file:///Users/panos/Documents/keim%20notes/src/lib/vault.ts)
- Update `readDirRecursive` to detect image files (pgn, jpg, etc.).
- Update `reconcileVault` to ensure images are mirrored between DB and Disk.
#### [MODIFY] [sync.ts](file:///Users/panos/Documents/keim%20notes/src/lib/sync.ts)
- Extend the `manifest.json` to track image assets.
- Add logic to upload/download binary assets to a `/keim/assets/` folder in Dropbox.

### [Editor UX]
#### [MODIFY] [Editor.tsx](file:///Users/panos/Documents/keim%20notes/src/components/Editor.tsx)
- Configure `Crepe` with an image feature.
- Implement an `imageUploadAdapter` that:
    1. Intercepts local file selections.
    2. Saves the file to the local `assets` DB.
    3. Returns a `blob:` URL for immediate editor preview.
    4. Triggers an auto-sync.

## Verification Plan

### Automated Tests
- No existing image tests found. I will add a test in `src/test/assets.test.ts` to verify DB asset persistence.

### Manual Verification
1. Drag and drop an image into the editor.
2. Verify it displays correctly.
3. Perform a sync and verify the image appears in the Dropbox `/keim/assets/` folder.
4. Open the app on another device/browser and verify the image syncs down.
