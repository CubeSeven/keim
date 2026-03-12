# Implementation Plan: Smart Properties & Dynamic Dashboards

A high-performance, local-first system for adding "Notion-like" structure to Markdown notes without compromising simplicity.

## Goals
- **Personal CMS**: Turn folders into structured databases (e.g., Clients, Invoices).
- **Zero Friction**: Keep features invisible ("Ghost strategy") until a user explicitly activates a "Smart Folder".
- **Performance**: Use native browser inputs and IndexedDB to maintain sub-millisecond responsiveness.

## User Experience Design

### 1. Smart Folders (The Setup)
- **Activation**: Right-click folder -> "Make Smart".
- **Configuration**: A popup (not a settings page) allows the user to define fields: `Phone`, `Amount`, `Status`.
- **Scope**: Properties are **Direct-Only**. No inheritance to subfolders. This prevents cluttered note headers in unrelated folders (like `Bio` or `Photos`).

### 2. Properties Header (The Form)
- **Visibility**: Appears at the top of notes inside Smart Folders ONLY.
- **Editing**: Inline, spreadsheet-style inputs.
- **Types**: Support for Text, Date (native picker), Number, and @Links (Relations).

### 3. Dynamic Dashboards (The Loop)
- **Self-Contained**: A special block in any note (typically in a parent folder) that renders a live table.
- **Functionality**: Queries a subfolder (e.g., `/Invoices`) and lists all notes with their metadata.
- **Actionable**: Click a name to open the note; click a "Status" in the table to update it globally.

## Technical Architecture

### Data Storage
- **Folder Metadata**: Each Smart Folder stores a hidden `.keim-schema.json`.
- **Note Metadata**: Stored as **YAML Frontmatter** at the top of individual `.md` files. 
    - *Example:*
      ```yaml
      ---
      status: Active
      amount: 500
      ---
      ```
- **Syncing**: 100% compatible with existing Dropbox logic. Standard text files only.

### Performance & Weight
- **No Extra Libraries**: Use native `<input type="date">` and CSS Grid for layout.
- **Query Engine**: Use Dexie's compound indices to filter hundreds of notes in milliseconds.

## Testing & Risk Management

### Manual Verification Phases
Every major feature (Sidebar Toggle, Popup, Header, Table) will undergo a dedicated manual testing phase:
- **Phase 1 (Sidebar)**: Verify the context menu and icon visibility across different themes.
- **Phase 2 (Popup)**: Ensure property creation doesn't crash the app and data is correctly written to `.keim-schema.json`.
- **Phase 3 (Header)**: Test edge cases in YAML parsing (e.g., special characters in property names).
- **Phase 4 (Dashboard)**: Verify table filtering and "Active Links" for large note sets (100+ items).

### Isolation & Fallback
To ensure the app remains stable during development, all new features will be "Isolatable":
- **Feature Flags**: New components will be guarded by a `ENABLE_SMART_PROPS` flag in `constants.ts`. If implementation fails, we can disable the flag and the app returns to its original "Classic" state instantly.
- **Non-Destructive Data**: Smart Folder metadata is stored in a *separate* file (`.keim-schema.json`). If we remove the feature, the user's notes remain untouched and 100% valid Markdown.

## Deployment Strategy
1. **Local Testing (Mac/Windows)**: All development and initial manual verification happens on the local development server.
2. **Quality Gate**: New features will NOT be pushed to the `main` branch or the live URL until all manual verification phases pass.
3. **GH Pages Deployment**: Automated deployment via `npm run deploy` will only trigger after the final verification of the master feature flag.
