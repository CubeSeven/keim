import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmModal({
    isOpen,
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
}: ConfirmModalProps) {
    return (
        <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
            <AnimatePresence>
                {isOpen && (
                    <Dialog.Portal forceMount>
                        <Dialog.Overlay asChild>
                            <motion.div
                                className="fixed inset-0 z-[200] bg-dark-bg/40 backdrop-blur-sm"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                            />
                        </Dialog.Overlay>
                        <Dialog.Content asChild>
                            <motion.div
                                className="fixed z-[201] left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6 rounded-2xl bg-light-bg dark:bg-dark-surface border border-dark-bg/8 dark:border-light-bg/8 shadow-2xl"
                                initial={{ opacity: 0, scale: 0.95, y: '-48%' }}
                                animate={{ opacity: 1, scale: 1, y: '-50%' }}
                                exit={{ opacity: 0, scale: 0.95, y: '-48%' }}
                                transition={{ duration: 0.15, ease: 'easeOut' }}
                            >
                                <Dialog.Title className="text-lg font-bold text-dark-bg dark:text-light-bg mb-2">
                                    {title}
                                </Dialog.Title>
                                <Dialog.Description className="text-sm text-dark-bg/60 dark:text-light-bg/60 leading-relaxed mb-6">
                                    {description}
                                </Dialog.Description>

                                <div className="flex gap-3 justify-end">
                                    <button
                                        onClick={onCancel}
                                        className="px-4 py-2 rounded-lg text-sm font-medium text-dark-bg/70 dark:text-light-bg/70 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 transition-colors"
                                    >
                                        {cancelLabel}
                                    </button>
                                    <button
                                        onClick={onConfirm}
                                        className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 transition-colors shadow-md shadow-indigo-500/20"
                                    >
                                        {confirmLabel}
                                    </button>
                                </div>
                            </motion.div>
                        </Dialog.Content>
                    </Dialog.Portal>
                )}
            </AnimatePresence>
        </Dialog.Root>
    );
}
