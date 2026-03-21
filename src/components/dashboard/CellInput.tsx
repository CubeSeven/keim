import { useState } from 'react';

/**
 * CellInput — key-remount strategy for live sync + stable cursor.
 *
 * The `key` prop is driven by `value` (the external DB-backed value).
 * - While user types: `notes` state is unchanged → same key → no remount → cursor stable
 * - When external update arrives (Dashboard event or PropertiesHeader sync):
 *     `notes` state changes → new key → input remounts with fresh `defaultValue` ✅
 */
export const CellInput = ({
    value,
    type,
    onSave,
    placeholder,
    className,
    style,
    title,
}: {
    value: string;
    type: string;
    onSave: (val: string) => void;
    placeholder?: string;
    className?: string;
    style?: React.CSSProperties;
    title?: string;
}) => {
    // URL display mode (clickable link)
    const [editingUrl, setEditingUrl] = useState(false);
    const isUrl = type === 'text' && value.match(/^https?:\/\/[^\s]+$/i);

    if (isUrl && !editingUrl) {
        return (
            <div className="flex items-center justify-between group/link w-full" style={style}>
                <a href={value} target="_blank" rel="noreferrer"
                    className="text-indigo-500 hover:underline truncate px-1" title={value}>
                    {value}
                </a>
                <button onClick={(e) => { e.stopPropagation(); setEditingUrl(true); }}
                    className="opacity-0 group-hover/link:opacity-100 text-dark-bg/40 hover:text-dark-bg/80 dark:text-light-bg/40 dark:hover:text-light-bg/80 px-1 shrink-0 transition-opacity"
                    title="Edit link">✎
                </button>
            </div>
        );
    }

    return (
        <input
            key={value}          // ← remounts when external DB value changes (live sync)
            type={type}
            defaultValue={value} // ← uncontrolled: user typing never causes re-renders
            placeholder={placeholder}
            onBlur={(e) => {
                const newVal = e.target.value;
                if (newVal !== value) {
                    setTimeout(() => onSave(newVal), 20); // slightly longer delay for Firefox stability
                }
                if (editingUrl) setEditingUrl(false);
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
            onChange={(e) => {
                // Firefox spinner clicks don't focus the input natively! Force it here
                // so that clicking away later successfully triggers the blur event.
                if (document.activeElement !== e.target) {
                    e.target.focus();
                }
            }}
            autoFocus={editingUrl}
            style={style}
            className={className}
            title={title}
        />
    );
};
