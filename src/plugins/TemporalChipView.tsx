import { useNodeViewContext } from '@prosemirror-adapter/react';
import { Calendar } from 'lucide-react';

export const TemporalChipView = () => {
    const { node } = useNodeViewContext();
    const { value, date } = node.attrs;
    const dateObj = new Date(date);
    
    // Format date in a pretty way
    const isToday = new Date().toDateString() === dateObj.toDateString();
    const formattedDate = dateObj.toLocaleDateString(undefined, { 
        month: 'short', 
        day: 'numeric',
        year: dateObj.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined 
    });

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const year = dateObj.getFullYear();
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const day = dateObj.getDate().toString().padStart(2, '0');
        
        // Open Google Calendar for that specific day
        window.open(`https://calendar.google.com/calendar/u/0/r/day/${year}/${month}/${day}`, '_blank');
    };

    return (
        <span 
            className="temporal-chip inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800/40 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700/50 text-[0.85em] cursor-pointer select-none transition-all hover:bg-zinc-200 dark:hover:bg-zinc-700/60"
            onClick={handleClick}
            title={`${value} → ${dateObj.toLocaleString()} (Click to open Calendar)`}
        >
            <Calendar size={12} className="opacity-60" />
            <span className="font-medium tracking-tight">{value}</span>
            <span className="opacity-40 text-[0.85em] font-normal">({isToday ? 'Today' : formattedDate})</span>
        </span>
    );
};
