# Keim Notes Roadmap

This document captures planned features and architectural improvements for Keim.

## 🌟 Future UI: Notion-like Views
Expand the Smart Folder dashboards with dynamic views powered by YAML frontmatter.

### 1. Board View (Kanban)
*   **Goal:** Drag-and-drop task management.
*   **Trigger:** Select a `select` field (e.g., "Status") to define columns.
*   **Implementation:** Use `dnd-kit` for premium animations and high-performance dragging.

### 2. Gallery View
*   **Goal:** Visual-first grid for creative folders, recipe books, etc.
*   **Trigger:** Auto-displays icons and metadata cards.
*   **Implementation:** Clean CSS Grid layout with glassmorphic card styles.

### 3. Calendar View
*   **Goal:** Map notes to time.
*   **Trigger:** Requires a `date` field.
*   **Implementation:** Lightweight calendar grid (e.g., `react-day-picker`) integrated with frontmatter dates.

### 4. Timeline
*   **Goal:** Horizontal project mapping.
*   **Trigger:** Requires two `date` fields ("Start" and "End").

---

## 🏗 Planned Infrastructure
*   **Rich Image Support:** Native support for image fields and gallery thumbnails.
*   **Shared Dashboards:** Ability to link a single dashboard view into multiple notes.
*   **Advanced Relations:** Bi-directional linking in the Smart Table.

---

## 🚀 Performance & Optimizations
*   **Lazy Loading & Bundle Splitting:** Defer loading heavy components like `Editor`, `SettingsModal`, or `CommandPalette` to improve initial load time.
*   **Premium Micro-Animations:** Introduce `framer-motion` for smooth UI transitions (sidebar, modals, list reordering).
*   **Search Engine Optimization:** Replace basic search with `FlexSearch` or `MiniSearch` for typo-tolerant, instantaneous full-text search.
*   **Offline Sync Queue:** Track offline mutations and automatically push them to the Vault/Dropbox upon network restore.
