import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import { db, addItem } from './lib/db';
import { Menu } from 'lucide-react';
import SettingsModal from './components/SettingsModal';

function App() {
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Theme initialization
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(() => {
    const stored = localStorage.getItem('keim_theme') as 'light' | 'dark' | 'system';
    return stored || 'system';
  });

  const setTheme = (newTheme: 'light' | 'dark' | 'system') => {
    setThemeState(newTheme);
    localStorage.setItem('keim_theme', newTheme);
    applyTheme(newTheme);
  };

  const applyTheme = (currentTheme: 'light' | 'dark' | 'system') => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (currentTheme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(currentTheme);
    }
  };

  useEffect(() => {
    applyTheme(theme);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') applyTheme('system');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Enhanced Seeder for Usability Testing
  useEffect(() => {
    async function seedDatabase() {
      try {
        const count = await db.items.count();
        const hasSeeded = localStorage.getItem('notes_seeded_v2');

        // Wipe and recreate cleanly once, or if completely empty
        if (!hasSeeded || count === 0) {
          localStorage.setItem('notes_seeded_v2', 'true');
          await db.items.clear();
          await db.contents.clear();

          // Create a "Getting Started" Folder
          const folderId = await addItem({
            parentId: 0,
            type: 'folder',
            title: '🚀 Getting Started'
          });

          // Add notes inside that folder
          await addItem({
            parentId: folderId,
            type: 'note',
            title: 'Welcome to Keim Notes'
          }, '# Welcome to Keim Notes\n\nThis is a local-first, high-performance note-taking app.\n\n### Key Features:\n- **Hierarchical Folders**: Organize everything in a tree.\n- **Markdown Support**: Rich WYSIWYG editing powered by Milkdown.\n- **PWA**: Works offline, installs on your desktop/mobile.\n- **Zero Latency**: Everything is saved to your local IndexedDB.');

          await addItem({
            parentId: folderId,
            type: 'note',
            title: 'Cloud Sync Guide'
          }, '# Cloud Sync\n\nTo enable sync:\n1. Open `src/lib/sync.ts`.\n2. Add your Google Client ID.\n3. Click the Cloud icon in the sidebar.');

          // Create a nested subfolder
          const subFolderId = await addItem({
            parentId: folderId,
            type: 'folder',
            title: 'Deeply Nested Folder'
          });

          await addItem({
            parentId: subFolderId,
            type: 'note',
            title: 'Nested Note Example'
          }, 'This note is living inside a subfolder to demonstrate the hierarchical capabilities.');

          // Add a standalone note at root
          await addItem({
            parentId: 0,
            type: 'note',
            title: 'Quick Scratchpad'
          }, 'Use this for quick thoughts.');
        }
      } catch (e) {
        console.error("Error seeding database:", e);
      }
    }

    seedDatabase();
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden relative">
      {/* Sidebar Section */}
      <Sidebar
        selectedNoteId={selectedNoteId}
        onSelectNote={(id: number) => {
          setSelectedNoteId(id);
          // Only auto-close on mobile (< 768px)
          if (window.innerWidth < 768) {
            setIsSidebarOpen(false);
          }
        }}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onOpenSettings={() => {
          setIsSidebarOpen(false);
          setIsSettingsOpen(true);
        }}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
      />

      {/* Fixed Burger Button */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="fixed top-3 left-3 z-[60] p-2 hover:bg-light-ui dark:hover:bg-dark-ui rounded-lg text-dark-bg dark:text-light-bg transition-colors"
        aria-label="Toggle Sidebar"
      >
        <Menu size={20} />
      </button>

      {/* Main content/Editor Section */}
      {/* Margin-dodge logic: When sidebar is open on desktop, shift main content to avoid overlap */}
      <main
        className={`flex-1 flex flex-col h-full w-full overflow-hidden relative transition-all duration-300 ease-in-out ${isSidebarOpen ? 'md:ml-64' : 'ml-0'
          }`}
      >
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedNoteId ? (
            <Editor key={selectedNoteId} noteId={selectedNoteId} />
          ) : (
            <div className="flex h-full items-center justify-center text-dark-bg/50 dark:text-light-bg/50 p-6 text-center">
              <p>Select a note from the sidebar or create a new one.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
