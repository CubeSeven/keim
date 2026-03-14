import { useNodeViewContext } from '@prosemirror-adapter/react';
import Dashboard from '../components/Dashboard';
import { Trash2, Database } from 'lucide-react';

export const DashboardNodeView = ({ onSelectNote }: { onSelectNote: (id: number) => void }) => {
    const { node, view, getPos } = useNodeViewContext();
    const folderName = node.attrs.folder || '';

    const handleRemove = () => {
        const pos = getPos();
        if (pos !== undefined) {
            view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
        }
    };

    return (
        <div className="dashboard-node py-2 group">
            {/* Title bar — visible only on hover */}
            <div className="flex items-center justify-between px-1 pb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="flex items-center gap-2 text-dark-bg/40 dark:text-light-bg/35 select-none">
                    <Database size={12} className="text-indigo-400" />
                    <span className="text-[11px] font-bold uppercase tracking-widest">
                        Dashboard: {folderName}
                    </span>
                </div>
                <button
                    onClick={handleRemove}
                    title="Remove dashboard"
                    className="w-6 h-6 flex items-center justify-center rounded-md
                               text-dark-bg/25 dark:text-light-bg/20
                               hover:text-red-500 dark:hover:text-red-400
                               hover:bg-red-500/8 dark:hover:bg-red-400/8
                               transition-all"
                >
                    <Trash2 size={13} />
                </button>
            </div>

            <div 
                contentEditable={false}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onKeyUp={(e) => e.stopPropagation()}
                onKeyPress={(e) => e.stopPropagation()}
                onCut={(e) => e.stopPropagation()}
                onCopy={(e) => e.stopPropagation()}
                onPaste={(e) => e.stopPropagation()}
                onDragStart={(e) => e.stopPropagation()}
                onDrop={(e) => e.stopPropagation()}
                onBeforeInput={(e) => e.stopPropagation()}
            >
                <Dashboard folderName={folderName} onSelectNote={onSelectNote} />
            </div>
            <div className="h-4 invisible" />


        </div>
    );
};
