import { isFileSystemSupported } from '../lib/vault';
import { FolderOpen, Github, Globe, Download, Lock } from 'lucide-react';

interface WelcomeScreenProps {
    onPickVault: () => void;
    isPickingVault: boolean;
    installPrompt?: { prompt: () => void; userChoice: Promise<{ outcome: string }> } | null;
    onInstallPWA?: () => void;
}

const FeatureCard = ({ icon: Icon, title, description }: { icon: React.ElementType, title: string, description: string }) => (
    <div className="p-6 rounded-2xl border border-dark-bg/5 dark:border-light-bg/5 bg-white/40 dark:bg-dark-ui/40 backdrop-blur-md shadow-sm">
        <div className="w-10 h-10 rounded-xl bg-dark-bg/5 dark:bg-light-bg/5 flex items-center justify-center mb-4">
            <Icon size={20} className="text-dark-bg/70 dark:text-light-bg/70" />
        </div>
        <h3 className="text-sm font-bold mb-1.5 tracking-tight">{title}</h3>
        <p className="text-xs text-dark-bg/50 dark:text-light-bg/50 leading-relaxed">{description}</p>
    </div>
);

export default function WelcomeScreen({ onPickVault, isPickingVault, installPrompt, onInstallPWA }: WelcomeScreenProps) {
    const fsSupported = isFileSystemSupported();

    return (
        <div className="min-h-screen w-full bg-light-bg dark:bg-dark-bg overflow-x-hidden selection:bg-indigo-500/30">
            <div className="max-w-5xl mx-auto px-6 py-12 md:py-24">
                <div className="flex flex-col items-center text-center mb-20 md:mb-32 animate-rise">
                    <div className="relative mb-8">
                        <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full" />
                        <img src="keim_logo.svg" alt="Keim Logo" className="relative w-24 h-24 md:w-32 md:h-24 rounded-3xl shadow-2xl" />
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black tracking-tighter mb-6 bg-clip-text text-transparent bg-gradient-to-b from-dark-bg to-dark-bg/60 dark:from-light-bg dark:to-light-bg/60">
                        Think in fragments,<br />organize in systems.
                    </h1>
                    <p className="text-lg md:text-xl text-dark-bg/50 dark:text-light-bg/50 max-w-xl leading-relaxed mb-10 font-medium">
                        Keim is a minimal, local-first note app. Your notes are plain Markdown <code className="bg-dark-bg/10 dark:bg-light-bg/10 px-1 rounded font-mono">.md</code> files on your own disk. No accounts, no tracking, no database.
                    </p>

                    <div className="flex flex-col items-center gap-4 w-full max-w-md animate-rise">
                        {fsSupported ? (
                            <button
                                onClick={onPickVault}
                                disabled={isPickingVault}
                                className="w-full px-8 py-4 bg-indigo-500 text-white rounded-full font-bold text-sm shadow-xl shadow-indigo-500/20 hover:bg-indigo-600 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-60"
                            >
                                <FolderOpen size={18} /> {isPickingVault ? 'Waiting for folder…' : 'Choose a folder to store notes'}
                            </button>
                        ) : (
                            <div className="w-full px-6 py-4 rounded-2xl border border-dark-bg/10 dark:border-light-bg/10 bg-white/50 dark:bg-white/5 text-dark-bg/70 dark:text-light-bg/70 text-sm leading-relaxed">
                                Keim needs the <strong>File System Access API</strong> (desktop Chrome, Edge, or Brave). It is not available in this browser. Please open Keim on a supported desktop browser.
                            </div>
                        )}

                        {installPrompt && (
                            <button onClick={onInstallPWA} className="w-full px-8 py-3 bg-dark-bg dark:bg-light-bg text-light-bg dark:text-dark-bg rounded-full font-bold text-sm shadow-xl hover:opacity-90 transition-all active:scale-95 flex items-center justify-center gap-2">
                                <Download size={16} /> Install App
                            </button>
                        )}
                        <a href="https://github.com/CubeSeven/keim" target="_blank" rel="noopener noreferrer" className="w-full px-8 py-3 bg-white/50 dark:bg-white/5 backdrop-blur-md border border-dark-bg/10 dark:border-light-bg/10 rounded-full font-bold text-sm hover:bg-white/80 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-2">
                            <Github size={16} /> GitHub
                        </a>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-32 animate-rise">
                    <FeatureCard icon={Lock} title="Local-First Privacy" description="Your notes live purely on your disk. Total control, offline-first, native file system access." />
                    <FeatureCard icon={Globe} title="Plain Markdown" description="Every note is a readable .md file. Open them in any editor, no proprietary format, ever." />
                    <FeatureCard icon={Download} title="Open Source" description="Completely free and transparent. No subscriptions, no hidden fees, no lock-in. Forever." />
                </div>

                <div className="mt-16 text-center space-y-4 pb-20 animate-fadein">
                    <p className="mx-auto text-[11px] text-dark-bg/40 dark:text-light-bg/40 max-w-sm leading-relaxed font-medium">
                        Keim is in <span className="font-bold text-indigo-500/80 uppercase tracking-tighter">Public Beta</span>. Backup your folder regularly.
                        Found a bug? <a href="https://github.com/CubeSeven/keim/issues" target="_blank" rel="noopener noreferrer" className="underline hover:text-indigo-500 transition-colors">Report it on GitHub</a>.
                    </p>
                </div>
            </div>
        </div>
    );
}
