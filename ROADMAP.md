# Keim Notes Roadmap

This document categorizes planned features by implementation effort and complexity to help prioritize development.

---

## 🚀 Quick Wins (Low Effort, High Impact)
*These items have low code complexity and can be implemented quickly to improve the daily UX.*

*   **Beautified Links**: Enhanced rendering for internal and external links (CSS/UI tweaks).
*   **Single Note Duplication**: A "Duplicate" button in the context menu for notes.
*   **Popular App Integrations**: Inline chips and icons for links from YouTube, Twitter, GitHub, etc.
*   **Gallery View Refinements**: Minor styling updates to the glassmorphic cards.

---

## 🛠 Mid-Range Features (Moderate Effort)
*These require more logic or UI work but are still relatively straightforward.*

*   **Pomodoro Timer**: Integrated productivity timer with system notification support.
*   **App Notifications**: System-level alerts for sync events or timers.
*   **Folder Duplication**: Recursive logic to clone entire folder structures in the DB and Vault.
*   **Timeline View**: Horizontal mapping for folders with Start/End date fields.
*   **Sync Expansion**: Completing the backend integration for Google Drive and OneDrive.

---

## 🏗 Strategic / High Complexity (Long-Term Goals)
*Significant R&D or architectural changes required.*

*   **End-to-End Encryption (E2EE)**: Optional AES-GCM encryption for `.md` files before sync/storage.
*   **Toggle Lists**: Collapsible Notion-style list items (requires complex editor plugin work).
*   **Multi-Column Grid Blocks**: Structural layout blocks within notes (1-4 columns).
*   **Rich Image Support**: Native support for image fields and gallery thumbnails.
*   **Advanced Relations**: Bi-directional linking in the Smart Table.
*   **Sandboxed Plugin System**: Secure, PWA-safe plugin loader for UI extensions.

---

## ✅ Completed Recently
*   **Kanban, Gallery, & Calendar Views**: Fully implemented in Dashboards.
*   **Tag Filtering**: Sidebar tag clicks filter notes.
*   **Local-First Vault**: Bi-directional sync for `.md` files.
*   **Dropbox Sync**: Initial cloud backup solution.
*   **API Documentation**: Formal YAML schema definition in `docs/API.md`.
