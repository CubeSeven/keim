import { type DashboardViewProps } from './types';

export function GalleryView({
    notes,
    schema,
    onSelectNote,
}: DashboardViewProps) {
    if (notes.length === 0) {
        return (
            <div style={{ padding: '40px 20px', textAlign: 'center', opacity: 0.35, fontSize: '0.85rem' }}>
                No notes in this folder yet.
            </div>
        );
    }

    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '14px',
                padding: '16px',
            }}
        >
            {notes.map(row => (
                <button
                    key={row.item.id}
                    onClick={() => onSelectNote(row.item.id!)}
                    className="group/card text-left flex flex-col rounded-xl border border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 hover:-translate-y-1 hover:shadow-2xl dark:hover:shadow-black/50 transition-all duration-300 overflow-hidden focus:outline-none focus:ring-2 focus:ring-black/15 dark:focus:ring-white/15 bg-white/70 dark:bg-dark-ui/60 backdrop-blur-xl"
                    style={{
                        padding: '24px',
                        boxShadow: '0 8px 32px -4px rgba(0,0,0,0.04), inset 0 1px 1px rgba(255,255,255,0.5)',
                        minHeight: '180px',
                    }}
                >
                    {/* Icon + Title */}
                    <div className="flex items-start gap-2.5 mb-4 w-full">
                        {row.item.icon && (
                            <span style={{ fontSize: '1.5rem', lineHeight: 1, flexShrink: 0 }}>{row.item.icon}</span>
                        )}
                        <span
                            className="text-sm font-semibold text-dark-bg dark:text-light-bg leading-snug w-full"
                            style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                        >
                            {row.item.title || 'Untitled'}
                        </span>
                    </div>

                    {schema && (
                        <div className="mt-auto w-full">
                            {/* Divider */}
                            {schema.fields.some(f => !!row.meta[f.name]) && (
                                <div style={{ borderTop: '1px solid rgba(128,128,128,0.12)', margin: '14px 0' }} />
                            )}

                            {/* Meta Fields */}
                            {schema.fields.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {schema.fields.map(f => {
                                        const val = row.meta[f.name];
                                        if (!val) return null;
                                        return (
                                            <div key={f.name} className="flex items-start gap-2 max-w-full overflow-hidden">
                                                <span className="text-[10px] font-medium uppercase tracking-wider text-black/40 dark:text-white/40 flex-shrink-0 w-20 truncate">
                                                    {f.name}
                                                </span>
                                                <span className="text-xs text-dark-bg/80 dark:text-light-bg/80 font-medium truncate">
                                                    {val}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </button>
            ))}
        </div>
    );
}
