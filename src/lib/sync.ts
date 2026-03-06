import { db } from './db';

declare global {
    interface Window {
        google?: any;
    }
}

// In a real app, you would place this in a .env file
const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let accessToken: string | null = null;

export function authorizeDrive(): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!window.google) {
            return reject(new Error('Google Identity Services script not loaded.'));
        }

        const client = window.google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (response: any) => {
                if (response.error) {
                    console.error("Auth error", response.error);
                    reject(response.error);
                } else {
                    accessToken = response.access_token;
                    resolve(response.access_token);
                }
            },
        });

        client.requestAccessToken();
    });
}

/**
 * Synchronize local Dexie database with Google Drive's appDataFolder
 */
export async function syncNotesWithDrive() {
    if (!accessToken) {
        await authorizeDrive();
    }

    try {
        const fileId = await getRemoteFileId();
        const localItems = await db.items.toArray();
        const localContents = await db.contents.toArray();

        const localData = { items: localItems, contents: localContents };
        const fileContent = JSON.stringify(localData);

        if (fileId) {
            const remoteText = await downloadRemoteFile(fileId);
            let remoteData: { items: any[], contents: any[] } = { items: [], contents: [] };
            try {
                if (remoteText) {
                    const parsed = JSON.parse(remoteText);
                    // Handle legacy data structure in case v1 was synced
                    if (Array.isArray(parsed)) {
                        remoteData.items = parsed.map((p: any) => {
                            const { content, ...rest } = p;
                            return rest;
                        });
                        remoteData.contents = parsed.filter((p: any) => p.type === 'note').map((p: any) => ({ id: p.id, content: p.content || '' }));
                    } else {
                        remoteData = parsed;
                    }
                }
            } catch (e) { }

            const { mergedItems, mergedContents } = mergeData(localData, remoteData);

            await db.transaction('rw', db.items, db.contents, async () => {
                await db.items.clear();
                await db.contents.clear();
                await db.items.bulkAdd(mergedItems);
                await db.contents.bulkAdd(mergedContents);
            });

            await updateRemoteFile(fileId, JSON.stringify({ items: mergedItems, contents: mergedContents }));
        } else {
            await createRemoteFile(fileContent);
        }
        console.log("Sync complete!");
    } catch (err) {
        console.error("Sync failed:", err);
        throw err;
    }
}

async function getRemoteFileId(): Promise<string | null> {
    const q = encodeURIComponent("name = 'data.json'");
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    if (data.files && data.files.length > 0) {
        return data.files[0].id;
    }
    return null;
}

async function createRemoteFile(content: string) {
    const metadata = {
        name: 'data.json',
        parents: ['appDataFolder']
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([content], { type: 'application/json' }));

    await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form
    });
}

async function updateRemoteFile(fileId: string, content: string) {
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: content
    });
}

async function downloadRemoteFile(fileId: string): Promise<string | null> {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.ok) {
        return await res.text();
    }
    return null;
}

function mergeData(local: any, remote: any) {
    const remoteItemsMap = new Map<number, any>();
    remote.items.forEach((item: any) => remoteItemsMap.set(item.id, item));

    const remoteContentsMap = new Map<number, any>();
    remote.contents.forEach((c: any) => remoteContentsMap.set(c.id, c));

    const localContentsMap = new Map<number, any>();
    local.contents.forEach((c: any) => localContentsMap.set(c.id, c));

    const mergedItemsMap = new Map<number, any>();
    const mergedContentsMap = new Map<number, any>();

    // First merge remote
    remote.items.forEach((remoteItem: any) => {
        mergedItemsMap.set(remoteItem.id, remoteItem);
        if (remoteItem.type === 'note' && remoteContentsMap.has(remoteItem.id)) {
            mergedContentsMap.set(remoteItem.id, remoteContentsMap.get(remoteItem.id));
        }
    });

    // Then overwrite with local if local is newer
    local.items.forEach((localItem: any) => {
        const existing = mergedItemsMap.get(localItem.id);
        if (!existing || localItem.updated_at > existing.updated_at) {
            mergedItemsMap.set(localItem.id, localItem);
            if (localItem.type === 'note' && localContentsMap.has(localItem.id)) {
                mergedContentsMap.set(localItem.id, localContentsMap.get(localItem.id));
            }
        }
    });

    return {
        mergedItems: Array.from(mergedItemsMap.values()),
        mergedContents: Array.from(mergedContentsMap.values())
    };
}
