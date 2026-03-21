import type { NoteItem, SmartSchema } from '../../lib/db';

export type RowData = {
    item: NoteItem;
    meta: Record<string, string>;
    rawContent: string;
};

export type DashboardViewProps = {
    notes: RowData[];
    schema?: SmartSchema | null;
    onSelectNote: (id: number) => void;
};
