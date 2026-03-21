import { useState } from 'react';
import { isFileSystemSupported } from '../lib/vault';
import { FolderOpen, Database, ArrowRight, ShieldCheck, Zap, Layers, Github, Globe, Smartphone, Download, Lock, ChevronLeft } from 'lucide-react';
import { motion, type Variants } from 'framer-motion';

interface WelcomeScreenProps {
    onPickVault: () => void;
    onUseBrowserStorage: () => void;
    isPickingVault: boolean;
    installPrompt?: { prompt: () => void; userChoice: Promise<{ outcome: string; }> } | null;
    onInstallPWA?: () => void;
}

export default function WelcomeScreen({ onPickVault, onUseBrowserStorage, isPickingVault, installPrompt, onInstallPWA }: WelcomeScreenProps) {
    const fsSupported = isFileSystemSupported();
    const [showStorageOptions, setShowStorageOptions] = useState(false);

    const containerVariants: Variants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1,
                delayChildren: 0.1
            }
        }
    };

    const itemVariants: Variants = {
        hidden: { opacity: 0, y: 20 },
        visible: { 
            opacity: 1, 
            y: 0, 
            transition: { duration: 0.5, ease: "easeOut" } 
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FeatureCard = ({ icon: Icon, title, description }: { icon: any, title: string, description: string }) => (
        <motion.div 
            variants={itemVariants}
            className="p-6 rounded-2xl border border-dark-bg/5 dark:border-light-bg/5 bg-white/40 dark:bg-dark-ui/40 backdrop-blur-md shadow-sm hover:shadow-md transition-all duration-300 group"
        >
            <div className="w-10 h-10 rounded-xl bg-dark-bg/5 dark:bg-light-bg/5 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <Icon size={20} className="text-dark-bg/70 dark:text-light-bg/70" />
            </div>
            <h3 className="text-sm font-bold mb-1.5 tracking-tight">{title}</h3>
            <p className="text-xs text-dark-bg/50 dark:text-light-bg/50 leading-relaxed">{description}</p>
        </motion.div>
    );

    if (showStorageOptions) {
        return (
            <div className="min-h-screen w-full bg-light-bg dark:bg-dark-bg flex items-center justify-center selection:bg-indigo-500/30 p-6">
                <motion.div 
                    initial="hidden"
                    animate="visible"
                    variants={containerVariants}
                    className="max-w-xl w-full flex flex-col items-center"
                >
                    <motion.button 
                        variants={itemVariants}
                        onClick={() => setShowStorageOptions(false)}
                        className="self-start mb-8 text-dark-bg/50 dark:text-light-bg/50 hover:text-dark-bg dark:hover:text-light-bg flex items-center gap-2 text-sm font-bold transition-colors"
                    >
                        <ChevronLeft size={16} /> Back
                    </motion.button>

                    <motion.div variants={itemVariants} className="relative mb-6">
                        <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full" />
                        <img 
                            src="keim_logo.svg" 
                            alt="Keim Logo" 
                            className="relative w-16 h-16 md:w-20 md:h-20"
                        />
                    </motion.div>

                    <motion.h2 variants={itemVariants} className="text-3xl font-black tracking-tight mb-4 text-center">
                        Pick your storage
                    </motion.h2>
                    <motion.p variants={itemVariants} className="text-dark-bg/50 dark:text-light-bg/50 text-center text-sm mb-10 max-w-sm">
                        Choose how you want to keep your notes. You can always change this later in settings.
                    </motion.p>

                    <motion.div variants={itemVariants} className="flex flex-col gap-4 w-full">
                        {/* Option A: Vault Folder (Desktop Only) */}
                        {fsSupported && (
                            <button
                                onClick={onPickVault}
                                disabled={isPickingVault}
                                className="group flex items-start gap-5 p-6 rounded-2xl border-2 border-indigo-500/20 hover:border-indigo-500 bg-indigo-500/5 hover:bg-indigo-500/10 transition-all duration-300 text-left w-full disabled:opacity-60"
                            >
                                <div className="mt-1 text-indigo-500 shrink-0">
                                    <FolderOpen size={28} />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-bold text-dark-bg dark:text-light-bg text-lg">
                                            Open Vault Folder
                                        </span>
                                        <span className="text-[10px] font-black uppercase tracking-widest bg-indigo-500 text-white px-2 py-0.5 rounded-full">
                                            Pro
                                        </span>
                                    </div>
                                    <p className="text-dark-bg/60 dark:text-light-bg/60 text-sm leading-relaxed">
                                        Choose a folder on your computer. Notes are saved as <code className="bg-dark-bg/10 dark:bg-light-bg/10 px-1 rounded font-mono">.md</code> files readable by any app.
                                    </p>
                                    {isPickingVault && (
                                        <p className="text-indigo-500 text-xs mt-3 font-bold animate-pulse">Waiting for permission...</p>
                                    )}
                                </div>
                                <ArrowRight size={20} className="text-dark-bg/20 dark:text-light-bg/20 group-hover:text-indigo-500 transition-colors mt-2 shrink-0 group-hover:translate-x-1 duration-300" />
                            </button>
                        )}

                        {/* Option B: Browser Storage */}
                        <button
                            onClick={onUseBrowserStorage}
                            className="group flex items-start gap-5 p-6 rounded-2xl border-2 border-dark-bg/10 dark:border-light-bg/10 hover:border-dark-bg/30 dark:hover:border-light-bg/30 bg-white/50 dark:bg-white/5 hover:bg-dark-bg/5 dark:hover:bg-white/10 transition-all duration-300 text-left w-full"
                        >
                            <div className="mt-1 text-dark-bg/40 dark:text-light-bg/40 shrink-0 group-hover:text-dark-bg group-hover:dark:text-light-bg transition-colors duration-300">
                                <Database size={28} />
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-bold text-dark-bg dark:text-light-bg text-lg">
                                        Browser Storage
                                    </span>
                                    {!fsSupported && (
                                        <span className="text-[10px] font-black uppercase tracking-widest bg-indigo-500 text-white px-2 py-0.5 rounded-full">
                                            Mobile
                                        </span>
                                    )}
                                </div>
                                <p className="text-dark-bg/60 dark:text-light-bg/60 text-sm leading-relaxed">
                                    Perfect for web and mobile. Notes are kept in your browser database. Sync with <strong>Dropbox</strong> to keep them safe.
                                </p>
                            </div>
                            <ArrowRight size={20} className="text-dark-bg/20 dark:text-light-bg/20 group-hover:text-dark-bg dark:group-hover:text-light-bg transition-colors mt-2 shrink-0 group-hover:translate-x-1 duration-300" />
                        </button>
                    </motion.div>

                    <motion.div variants={itemVariants} className="mt-12 text-center flex items-center justify-center gap-2 text-dark-bg/30 dark:text-light-bg/30 text-[10px] uppercase font-black tracking-widest">
                        <Lock size={12} />
                        <span>Zero-Knowledge Encryption Available</span>
                    </motion.div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full bg-light-bg dark:bg-dark-bg overflow-x-hidden selection:bg-indigo-500/30">
            <div className="max-w-5xl mx-auto px-6 py-12 md:py-24">
                
                {/* Hero Section */}
                <motion.div 
                    initial="hidden"
                    animate="visible"
                    variants={containerVariants}
                    className="flex flex-col items-center text-center mb-20 md:mb-32"
                >
                    <motion.div variants={itemVariants} className="relative mb-8">
                        <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full" />
                        <img 
                            src="keim_logo.svg" 
                            alt="Keim Logo" 
                            className="relative w-24 h-24 md:w-32 md:h-24 rounded-3xl shadow-2xl"
                        />
                    </motion.div>
                    
                    <motion.h1 variants={itemVariants} className="text-4xl md:text-6xl font-black tracking-tighter mb-6 bg-clip-text text-transparent bg-gradient-to-b from-dark-bg to-dark-bg/60 dark:from-light-bg dark:to-light-bg/60">
                        Think in fragments,<br/>organize in systems.
                    </motion.h1>
                    
                    <motion.p variants={itemVariants} className="text-lg md:text-xl text-dark-bg/50 dark:text-light-bg/50 max-w-xl leading-relaxed mb-10 font-medium">
                        Keim is a minimal, local-first note app that turns plain Markdown into structured databases. No accounts, no tracking, no friction.
                    </motion.p>

                    <motion.div variants={itemVariants} className="flex flex-wrap justify-center gap-4">
                        <button 
                            onClick={() => setShowStorageOptions(true)}
                            className="px-8 py-3 bg-dark-bg dark:bg-light-bg text-light-bg dark:text-dark-bg rounded-full font-bold text-sm shadow-xl hover:opacity-90 transition-all active:scale-95"
                        >
                            Get Started
                        </button>
                        {installPrompt && (
                            <button
                                onClick={onInstallPWA}
                                className="px-8 py-3 bg-indigo-500 text-white rounded-full font-bold text-sm shadow-xl shadow-indigo-500/20 hover:bg-indigo-600 transition-all flex items-center gap-2 active:scale-95"
                            >
                                <Download size={16} /> Install App
                            </button>
                        )}
                        <a 
                            href="https://github.com/CubeSeven/keim" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-8 py-3 bg-white/50 dark:bg-white/5 backdrop-blur-md border border-dark-bg/10 dark:border-light-bg/10 rounded-full font-bold text-sm hover:bg-white/80 dark:hover:bg-white/10 transition-all flex items-center gap-2"
                        >
                            <Github size={16} /> GitHub
                        </a>
                    </motion.div>
                </motion.div>

                {/* Features Grid */}
                <motion.div 
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-100px" }}
                    variants={containerVariants}
                    className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-32"
                >
                    <FeatureCard 
                        icon={ShieldCheck} 
                        title="Local-First Privacy" 
                        description="Your notes live purely on your disk device. Total control over your data with offline, native file system access."
                    />
                    <FeatureCard 
                        icon={Lock} 
                        title="End-to-End Encryption" 
                        description="Military-grade zero-knowledge cloud sync. Your data is scrambled with AES-GCM before it ever leaves your device."
                    />
                    <FeatureCard 
                        icon={Layers} 
                        title="Smart Properties" 
                        description="Add Notion-like database power to plain Markdown files using simple YAML headers and custom schemas."
                    />
                    <FeatureCard 
                        icon={Zap} 
                        title="Dynamic Dashboards" 
                        description="Visualize your notes instantly. Switch between Kanban, Gallery, and Calendar views without any configuration."
                    />
                    <FeatureCard 
                        icon={Smartphone} 
                        title="PWA Ready" 
                        description="Install Keim on your phone or desktop. Works fully offline, loads instantly, and feels like a native application."
                    />
                    <FeatureCard 
                        icon={Globe} 
                        title="Open Source Tools" 
                        description="Completely free and transparent. No subscriptions, no hidden fees, no locked-in rigid formats. Forever."
                    />
                </motion.div>

                {/* Footer / Meta */}
                <motion.div 
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={containerVariants}
                    className="mt-16 text-center space-y-4 pb-20"
                >
                    <motion.p variants={itemVariants} className="mx-auto text-[11px] text-dark-bg/40 dark:text-light-bg/40 max-w-sm leading-relaxed font-medium">
                        Keim is in <span className="font-bold text-indigo-500/80 uppercase tracking-tighter">Public Beta</span>. While stable, we recommend regular backups of your Vault. 
                        Found a bug? <a href="https://github.com/CubeSeven/keim/issues" target="_blank" rel="noopener noreferrer" className="underline hover:text-indigo-500 transition-colors">Report it on GitHub</a>.
                    </motion.p>
                </motion.div>
            </div>
        </div>
    );
}
