import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Database, Sparkles, ChevronDown } from 'lucide-react';
import { readSchema, writeSchema, deleteSchema } from '../lib/smartProps';
import type { SmartField, FieldType } from '../lib/db';
import { getStorageMode } from '../lib/vault';
import { db, getFullPath } from '../lib/db';
import { motion } from 'framer-motion';
import { mirage } from 'ldrs';
mirage.register();

interface SmartFolderPopupProps {
    folderId: number;
    folderTitle: string;
    onClose: () => void;
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
    { value: 'text',     label: 'Text' },
    { value: 'number',   label: 'Number' },
    { value: 'date',     label: 'Date' },
    { value: 'link',     label: 'Link' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'select',   label: 'Select' },
    { value: 'relation', label: 'Relation' },
];

export default function SmartFolderPopup({ folderId, folderTitle, onClose }: SmartFolderPopupProps) {
    const [fields, setFields]             = useState<SmartField[]>([]);
    const [isLoading, setIsLoading]       = useState(true);
    const [isSaving, setIsSaving]         = useState(false);
    const [hasExistingSchema, setHasExistingSchema] = useState(false);

    useEffect(() => {
        async function load() {
            const schema = await readSchema(folderId);
            if (schema) { setFields(schema.fields); setHasExistingSchema(true); }
            setIsLoading(false);
        }
        load();
    }, [folderId]);

    const handleAddField    = () => setFields(p => [...p, { name: 'New Field', type: 'text' }]);
    const handleUpdateField = (i: number, c: Partial<SmartField>) =>
        setFields(p => { const n = [...p]; n[i] = { ...n[i], ...c }; return n; });
    const handleRemoveField = (i: number) => setFields(p => p.filter((_, x) => x !== i));

    async function getFolderPath() {
        if (getStorageMode() !== 'vault') return undefined;
        const allItems = await db.items.toArray();
        const base = getFullPath(folderId, allItems);
        return base ? `${base}/${folderTitle}` : folderTitle;
    }

    const handleSave = async () => {
        setIsSaving(true);
        await writeSchema(folderId, fields.filter(f => f.name.trim()), await getFolderPath());
        setIsSaving(false);
        onClose();
    };

    const handleRemoveSmart = async () => {
        if (!confirm('Remove Smart Properties from this folder? Existing note data is preserved.')) return;
        setIsSaving(true);
        await deleteSchema(folderId, await getFolderPath());
        setIsSaving(false);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
            onClick={e => e.target === e.currentTarget && onClose()}>
            
            <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm -z-10"
            />

            {/* Sheet on mobile (slides from bottom), centered dialog on sm+ */}
            <motion.div 
                initial={{ opacity: 0, y: 50, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.95 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="w-full sm:max-w-md flex flex-col sm:mx-4
                            max-h-[90vh] sm:max-h-[85vh]
                            rounded-t-xl sm:rounded-xl overflow-hidden shadow-2xl
                            border border-black/8 dark:border-white/10
                            bg-light-bg/95 dark:bg-[#1a1a1f]/95 backdrop-blur-xl">

                {/* ── Drag handle (mobile only) ── */}
                <div className="flex justify-center pt-3 pb-0 sm:hidden">
                    <div className="w-10 h-1 rounded-full bg-dark-bg/15 dark:bg-light-bg/15" />
                </div>

                {/* ── Header ── */}
                <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-black/6 dark:border-white/8">
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-md bg-dark-bg/8 dark:bg-light-bg/8 flex items-center justify-center shrink-0">
                            <Database size={14} className="text-dark-bg/70 dark:text-light-bg/70" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-dark-bg dark:text-light-bg leading-tight">
                                {hasExistingSchema ? 'Edit Smart Folder' : 'Make Smart Folder'}
                            </h2>
                            <p className="text-[11px] text-dark-bg/40 dark:text-light-bg/40 leading-tight truncate max-w-[180px]">{folderTitle}</p>
                        </div>
                    </div>
                    <button onClick={onClose}
                        className="w-7 h-7 flex items-center justify-center rounded-md text-dark-bg/40 dark:text-light-bg/40
                                   hover:bg-dark-bg/8 dark:hover:bg-light-bg/8 transition-all shrink-0 ml-2">
                        <X size={15} />
                    </button>
                </div>

                {/* ── Body ── */}
                <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">
                    <p className="text-xs text-dark-bg/50 dark:text-light-bg/40 mb-4 leading-relaxed">
                        Define structured properties for every note inside{' '}
                        <strong className="text-dark-bg/70 dark:text-light-bg/60">{folderTitle}</strong>.
                    </p>

                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <l-mirage size="28" speed="2.5" color="currentColor" />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {fields.length === 0 && (
                                <div className="flex flex-col items-center gap-2 py-8 rounded-lg
                                               border border-dashed border-black/8 dark:border-white/8
                                               text-dark-bg/40 dark:text-light-bg/30 text-xs">
                                    <Sparkles size={18} className="opacity-50" />
                                    No properties yet — tap below to add one.
                                </div>
                            )}

                            {fields.map((field, idx) => (
                                <div key={idx}
                                    className="flex flex-col gap-2 p-3 rounded-lg
                                               border border-black/6 dark:border-white/8
                                               bg-dark-bg/[0.02] dark:bg-white/[0.03]
                                               hover:border-black/10 dark:hover:border-white/10 transition-colors">

                                    {/* Row 1: name input + type selector + delete */}
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={field.name}
                                            onChange={e => handleUpdateField(idx, { name: e.target.value })}
                                            placeholder="Property name"
                                            className="flex-[3] min-w-[100px] bg-dark-bg/[0.04] dark:bg-white/[0.05]
                                                       rounded-md px-3 py-2 text-sm
                                                       text-dark-bg dark:text-light-bg
                                                       border border-black/6 dark:border-white/8
                                                       focus:ring-1 focus:ring-dark-bg/15 dark:focus:ring-light-bg/15 focus:border-black/15 dark:focus:border-white/15
                                                       outline-none placeholder-dark-bg/30 dark:placeholder-light-bg/30 transition-all"
                                        />

                                        <div className="relative flex-[2] min-w-[90px]">
                                            <select
                                                value={field.type}
                                                onChange={e => handleUpdateField(idx, { type: e.target.value as FieldType })}
                                                className="w-full appearance-none bg-dark-bg/[0.04] dark:bg-white/[0.05]
                                                           rounded-md pl-3 pr-8 py-2 text-sm
                                                           text-dark-bg dark:text-light-bg
                                                           border border-black/6 dark:border-white/8
                                                           focus:ring-1 focus:ring-dark-bg/15 dark:focus:ring-light-bg/15 outline-none cursor-pointer transition-all">
                                                {FIELD_TYPES.map((t, i) => <option key={`${t.value}-${i}`} value={t.value}>{t.label}</option>)}
                                            </select>
                                            <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-bg/40 dark:text-light-bg/40" />
                                        </div>

                                        {/* Delete — always visible */}
                                        <button
                                            onClick={() => handleRemoveField(idx)}
                                            className="w-8 h-8 flex items-center justify-center shrink-0 rounded-md
                                                       text-dark-bg/35 hover:text-red-500 dark:text-light-bg/25 dark:hover:text-red-400
                                                       hover:bg-red-500/10 active:bg-red-500/15 transition-all">
                                            <Trash2 size={15} />
                                        </button>
                                    </div>

                                    {/* Select options pill list */}
                                    {field.type === 'select' && (
                                        <div className="pl-2 border-l-2 border-dark-bg/10 dark:border-light-bg/10 mt-0.5">
                                            <p className="text-[10px] font-semibold text-dark-bg/40 dark:text-light-bg/35 uppercase tracking-widest mb-2">Options</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {(field.options || []).map((opt, oi) => (
                                                    <span key={`${opt}-${oi}`}
                                                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                                                                   bg-dark-bg/6 dark:bg-light-bg/6
                                                                   text-dark-bg/70 dark:text-light-bg/70
                                                                   border border-black/8 dark:border-white/8">
                                                        {opt}
                                                        <button
                                                            onClick={() => {
                                                                const o = [...(field.options || [])];
                                                                o.splice(oi, 1);
                                                                handleUpdateField(idx, { options: o });
                                                            }}
                                                            className="text-dark-bg/40 dark:text-light-bg/40 hover:text-red-500 transition-colors ml-0.5 leading-none">
                                                            <X size={9} />
                                                        </button>
                                                    </span>
                                                ))}
                                                <input
                                                    type="text"
                                                    placeholder="+ Add option"
                                                    className="bg-transparent border-none text-xs outline-none
                                                               text-dark-bg/60 dark:text-light-bg/50
                                                               placeholder-dark-bg/30 dark:placeholder-light-bg/25
                                                               w-24 py-0.5"
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') {
                                                            const v = e.currentTarget.value.trim();
                                                            if (v && !(field.options || []).includes(v)) {
                                                                handleUpdateField(idx, { options: [...(field.options || []), v] });
                                                                e.currentTarget.value = '';
                                                            }
                                                            e.preventDefault();
                                                        }
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}

                            <button
                                onClick={handleAddField}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium
                                           border border-dashed border-black/8 dark:border-white/8
                                           text-dark-bg/50 dark:text-light-bg/40
                                           hover:bg-dark-bg/5 dark:hover:bg-light-bg/5
                                           hover:border-black/10 dark:hover:border-white/10
                                           hover:text-dark-bg dark:hover:text-light-bg
                                           active:scale-[0.98] transition-all mt-1">
                                <Plus size={15} />
                                Add Property
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Footer ── */}
                <div className="flex items-center justify-between px-4 sm:px-5 py-3.5
                                border-t border-black/5 dark:border-white/8
                                bg-dark-bg/[0.02] dark:bg-white/[0.02]">
                    {hasExistingSchema ? (
                        <button
                            onClick={handleRemoveSmart}
                            disabled={isSaving}
                            className="text-xs font-medium text-red-500/70 hover:text-red-500
                                       hover:bg-red-500/8 px-3 py-2 rounded-md transition-all">
                            Remove Smart
                        </button>
                    ) : <div />}

                    <div className="flex items-center gap-2">
                        <button onClick={onClose}
                            className="px-3.5 py-2 text-sm font-medium text-dark-bg/60 dark:text-light-bg/50
                                       hover:bg-dark-bg/6 dark:hover:bg-light-bg/6 rounded-md transition-all">
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="px-4 py-2 text-sm font-semibold rounded-md
                                       bg-dark-bg text-light-bg dark:bg-light-bg dark:text-dark-bg
                                       hover:opacity-80 active:scale-95 transition-all
                                       flex items-center gap-2">
                            {isSaving && <l-mirage size="16" speed="2.5" color="white" />}
                            Save
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
