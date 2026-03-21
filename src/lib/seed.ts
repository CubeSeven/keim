import { db, addItem } from './db';
import { serializeYamlFrontmatter } from './smartProps';

export async function seedDatabase() {
    console.log('Seeding database with test data...');
    
    // Clear existing for a fresh slate
    await db.items.clear();
    await db.contents.clear();
    await db.smartSchemas.clear();

    // 1. Normal Folder "Welcome"
    const welcomeFolderId = await addItem({
        parentId: 0,
        type: 'folder',
        title: 'Welcome',
        icon: '👋',
    });

    await addItem({
        parentId: welcomeFolderId,
        type: 'note',
        title: 'Getting Started',
        icon: '🚀',
        tags: ['guide', 'onboarding']
    }, '# Welcome to Keim!\n\nThis is a dummy note to show you how normal notes work.');

    // 2. Smart Folder "Projects"
    const projectsFolderId = await addItem({
        parentId: 0,
        type: 'folder',
        title: 'Project Tracker',
        icon: '🎯',
    });

    await db.smartSchemas.add({
        folderId: projectsFolderId,
        fields: [
            { name: 'Due Date', type: 'date' },
            { name: 'Status', type: 'select', options: ['To Do', 'In Progress', 'Blocked', 'Done'] },
            { name: 'Priority', type: 'number' },
            { name: 'Urgent', type: 'checkbox' },
            { name: 'Owner', type: 'text' }
        ]
    });

    const p1Meta = {
        'Due Date': '2026-04-10',
        Status: 'In Progress',
        Priority: '1',
        Urgent: 'true',
        Owner: 'Alice'
    };
    await addItem({
        parentId: projectsFolderId,
        type: 'note',
        title: 'Redesign Landing Page',
        icon: '🎨',
    }, serializeYamlFrontmatter(p1Meta, '# Redesign Landing Page\n\nWe need to make it pop!'));

    const p2Meta = {
        'Due Date': '2026-03-25',
        Status: 'Blocked',
        Priority: '2',
        Urgent: 'false',
        Owner: 'Bob'
    };
    await addItem({
        parentId: projectsFolderId,
        type: 'note',
        title: 'Migrate to Postgres',
        icon: '🗄️',
    }, serializeYamlFrontmatter(p2Meta, '# Database Migration\n\nCurrently blocked on DevOps provisioning.'));

    const p3Meta = {
        'Due Date': '2026-05-01',
        Status: 'To Do',
        Priority: '3',
        Urgent: 'false',
        Owner: 'Charlie'
    };
    await addItem({
        parentId: projectsFolderId,
        type: 'note',
        title: 'Write User Auth Docs',
        icon: '📝',
    }, serializeYamlFrontmatter(p3Meta, '# Documentation\n\nDrafting JWT auth specs.'));

    const p4Meta = {
        'Due Date': '2026-03-20',
        Status: 'Done',
        Priority: '1',
        Urgent: 'true',
        Owner: 'Alice'
    };
    await addItem({
        parentId: projectsFolderId,
        type: 'note',
        title: 'Fix Login Bug',
        icon: '🐛',
    }, serializeYamlFrontmatter(p4Meta, '# Bug fix\n\nFixed off-by-one error in session timeout.'));
    
    // 3. Nested Folder System
    const workFolderId = await addItem({
        parentId: 0,
        type: 'folder',
        title: 'Work',
        icon: '🏢',
    });

    await addItem({
        parentId: workFolderId,
        type: 'folder',
        title: 'Meeting Notes',
        icon: '🤝',
    });

    console.log('Database seeded successfully! Please refresh the page to see the new nodes.');
}
