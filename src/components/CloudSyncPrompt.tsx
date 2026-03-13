import { useState, useEffect } from 'react';
import { Cloud, X } from 'lucide-react';

interface CloudSyncPromptProps {
    onConnect: () => void;
}

export default function CloudSyncPrompt({ onConnect }: CloudSyncPromptProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const dismissed = localStorage.getItem('keim_sync_prompt_dismissed');
        if (!dismissed) {
            // Slight delay so it doesn't pop up instantly jarring the user
            const timer = setTimeout(() => setIsVisible(true), 1500);
            return () => clearTimeout(timer);
        }
    }, []);

    const handleDismiss = () => {
        setIsVisible(false);
        localStorage.setItem('keim_sync_prompt_dismissed', 'true');
    };

    if (!isVisible) return null;

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-md z-[100] bg-light-bg/90 dark:bg-dark-bg/90 backdrop-blur-xl border border-light-ui dark:border-dark-ui shadow-2xl rounded-xl p-4 flex items-start gap-4 animate-in slide-in-from-bottom-5 duration-300">
            <div className="w-10 h-10 shrink-0 bg-indigo-500/10 rounded-lg flex items-center justify-center text-indigo-500">
                <Cloud size={20} />
            </div>
            <div className="flex-1">
                <h4 className="text-sm font-bold text-dark-bg dark:text-light-bg mb-1">Enable Cloud Sync?</h4>
                <p className="text-xs text-dark-bg/60 dark:text-light-bg/60 mb-3 leading-relaxed">
                    Connect Dropbox to automatically backup your notes and sync them across all your devices.
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={() => {
                            handleDismiss();
                            onConnect();
                        }}
                        className="px-3 py-1.5 bg-[#0061FF] text-white text-xs font-semibold rounded-lg hover:bg-[#0051d6] transition-colors shadow-md"
                    >
                        Connect Dropbox
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="px-3 py-1.5 bg-dark-bg/5 dark:bg-light-bg/5 hover:bg-dark-bg/10 dark:hover:bg-light-bg/10 text-dark-bg/70 dark:text-light-bg/70 text-xs font-semibold rounded-lg transition-colors"
                    >
                        Maybe Later
                    </button>
                </div>
            </div>
            <button
                onClick={handleDismiss}
                className="text-dark-bg/40 dark:text-light-bg/40 hover:text-dark-bg dark:hover:text-light-bg absolute top-2 right-2 p-1"
            >
                <X size={14} />
            </button>
        </div>
    );
}
