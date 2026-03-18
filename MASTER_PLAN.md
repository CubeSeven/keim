# Master Plan: Local-First Hierarchical Notes PWA

Based on the architectural blueprint research, here is the master plan for building your high-performance, local-first notes application.

## 1. Core Architecture & Tech Stack

- **Framework:** React + Vite (or SvelteKit) for minimal runtime overhead and rapid HMR.
- **Styling:** Tailwind CSS for a utility-first, unbreakable design system and native dark mode.
- **Persistence:** IndexedDB via Dexie.js for asynchronous, zero-latency local storage.
- **Editor:** CodeMirror 6 for modular, high-performance Markdown editing.
- **Cloud Sync:** OneDrive API (`AppFolder`) via Microsoft Graph and MSAL.js.
- **PWA / Offline:** `vite-plugin-pwa` with custom Service Worker for offline resilience.

## 2. Implementation Phases

### Phase 1: Foundation & Scaffolding
- Initialize the Vite project with React/Svelte and TypeScript.
- Install and configure Tailwind CSS (defining custom typography and minimal color tokens).
- Configure `vite-plugin-pwa` to generate a Service Worker with a `Cache-First` app shell strategy and full Web App Manifest for installability.

### Phase 2: Persistence Layer (Local-First)
- Set up Dexie.js and define the schema: `items: '++id, parentId, type, title, *tags, updated_at'`.
- Implement data access wrappers (`addItem`, `updateItem`, `moveItem`, `deleteItem`).
- Support composite indexing on `[parentId+title]` for fast folder traversal.
- **Data Security:** Implement optional AES-GCM encryption for `.md` files using the Web Crypto API to ensure privacy in the vault and across cloud sync.

### Phase 3: The Minimalist UI
- Build the **Sidebar**: A fixed-width container rendering a recursive folder tree, using Tailwind `group` modifiers for interactions.
- Build the **Editor Layout**: A flexible main pane with `max-w-prose` reading width.
- Implement UI state handling for mobile (collapsible sidebar) vs desktop.

### Phase 4: CodeMirror 6 Editor
- Integrate CodeMirror 6 and apply `@codemirror/lang-markdown`.
- Remove unnecessary programming-focused CodeMirror features (line numbers, gutter) to keep it minimal.
- Implement an update listener that debounces editor changes and saves them locally without blocking the UI rendering threads.

### Phase 5: OneDrive Cloud Sync
- Integrate Microsoft Authentication Library (MSAL.js) for easy "One-Click" login.
- Build the `SyncService`:
  - Diff local and remote timestamps using a "Last-Write-Wins" policy.
  - Use Microsoft Graph `delta` queries if possible, or direct file operations in the `AppFolder`.
  - Enable background sync for seamless roaming across devices.

### Phase 6: Polish, Testing & Deployment
- Set up an "Update Ready" prompt via the Service Worker.
- Run Lighthouse audits to ensure Performance and PWA scores stay >90.
- Perform heavy-load testing with deeply nested mock folders.
