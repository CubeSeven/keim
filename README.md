# Keim Notes

Think in fragments, organize in systems.

Keim is a minimal, local-first note-taking application designed for privacy and speed. It turns plain Markdown files into structured databases without the need for complex configuration or proprietary formats.

[**Launch App**](https://CubeSeven.github.io/keim/)

---

## 🌟 Core Philosophy

- **Local-First:** Your notes live on your disk, not our servers. We use the native File System Access API where available.
- **Markdown Native:** Your data is stored in standard `.md` files with YAML frontmatter. Readable by any text editor.
- **Zero Friction:** No accounts, no tracking, no subscription. Just you and your thoughts.
- **Extensible:** A modular plugin system built on top of Milkdown and ProseMirror.

## 🚀 Key Features

- **Smart Properties:** Define custom schemas for folders to add "Notion-like" metadata to your notes.
- **Dynamic Dashboards:** Visualize your notes instantly with Kanban, Gallery, and Calendar views.
- **Popular App Integrations:** Beautiful, lightweight chips and rich previews for YouTube, X (Twitter), GitHub, Google Docs, and more.
- **Wiki Links:** Connect your thoughts with `[[Internal Linking]]`.
- **PWA Ready:** Install it on your desktop or mobile device. Works offline.
- **Cloud Sync:** Optional, lightweight sync via Dropbox.

## 🛠 Tech Stack

- **Framework:** React 19 + TypeScript
- **Editor:** Milkdown (ProseMirror)
- **Database:** Dexie.js (IndexedDB)
- **Styling:** Tailwind CSS 4
- **Animation:** Framer Motion

## 🏗 Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm run test:run

# Build for production
npm run build
```

## 🤝 Contributing

Keim is open source and in **Public Beta**. We welcome contributions, bug reports, and feature requests. Feel free to open an issue or submit a pull request on our [GitHub repository](https://github.com/CubeSeven/keim).

## 📄 License

This project is licensed under the [MIT License](LICENSE).
