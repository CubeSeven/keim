import { type DashboardViewProps } from './types';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import './CalendarView.css';

export function CalendarView({
    notes,
    schema,
    onSelectNote,
}: DashboardViewProps) {
    if (!schema) return null;
    
    // Find first date field in schema
    const dateField = schema.fields.find(f => f.type === 'date');

    if (!dateField) {
        return (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📅</div>
                <div className="text-sm text-dark-bg/50 dark:text-light-bg/50 font-medium">
                    Add a <strong>Date</strong> field to this Smart Folder to use Calendar view.
                </div>
            </div>
        );
    }

    interface CalendarEvent {
        id: string;
        title: string;
        date: string;
        allDay: boolean;
        extendedProps: {
            icon?: string;
            noteId: number;
        };
    }

    const events: CalendarEvent[] = Object.values(notes).map(row => {
        const val = row.meta[dateField.name];
        if (!val) return null;
        return {
            id: String(row.item.id),
            title: row.item.title || 'Untitled',
            date: val,
            allDay: true,
            extendedProps: {
                icon: row.item.icon,
                noteId: row.item.id,
            }
        };
    }).filter(Boolean) as CalendarEvent[];

    return (
        <div className="p-4 rounded-xl calendar-container" style={{ minHeight: '600px' }}>
            <FullCalendar
                plugins={[dayGridPlugin, interactionPlugin]}
                initialView="dayGridMonth"
                events={events}
                eventClick={(info) => {
                    info.jsEvent.preventDefault(); // Prevent URL navigation just in case
                    info.jsEvent.stopPropagation();
                    const noteId = info.event.extendedProps.noteId;
                    if (noteId) onSelectNote(Number(noteId));
                }}
                eventContent={(arg) => {
                    return (
                        <button 
                            className="flex items-center gap-1.5 overflow-hidden w-full px-1 text-left"
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const noteId = arg.event.extendedProps.noteId;
                                if (noteId) onSelectNote(Number(noteId));
                            }}
                        >
                            {arg.event.extendedProps.icon && (
                                <span className="flex-shrink-0" style={{ fontSize: '1.2em' }}>{arg.event.extendedProps.icon}</span>
                            )}
                            <span className="truncate text-dark-bg/85 dark:text-light-bg/85">{arg.event.title}</span>
                        </button>
                    );
                }}
                height="600px"
                headerToolbar={{
                    left: 'title',
                    center: 'dayGridMonth,dayGridWeek',
                    right: 'prev,today,next'
                }}
            />
        </div>
    );
}
