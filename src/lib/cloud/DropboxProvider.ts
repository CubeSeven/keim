import { Dropbox, DropboxAuth } from 'dropbox';
import type { CloudProvider } from './CloudProvider';

interface DropboxTokenResponse {
    refresh_token?: string;
}

const CLIENT_ID = import.meta.env.VITE_DROPBOX_APP_KEY as string;

// All data lives under /keim/ inside the app‑folder so it works regardless of
// whether the Dropbox app is configured as "App Folder" or "Full Dropbox".
const APP_ROOT = '/keim';

export class DropboxProvider implements CloudProvider {
    id = 'dropbox';
    name = 'Dropbox';
    
    private dbxAuth: DropboxAuth | null = null;
    private dbx: Dropbox | null = null;
    private folderChecked = false;

    private getDbxAuth(): DropboxAuth | null {
        if (!this.dbxAuth) {
            if (!CLIENT_ID) return null;
            this.dbxAuth = new DropboxAuth({ clientId: CLIENT_ID });
        }
        return this.dbxAuth;
    }

    private getRedirectUri(): string {
        if (window.location.hostname === 'cubeseven.github.io') {
            return 'https://CubeSeven.github.io/keim';
        }
        return (window.location.origin + window.location.pathname).replace(/\/$/, '');
    }

    async authorize(): Promise<boolean> {
        const auth = this.getDbxAuth();
        if (!auth) return false;

        // 1. Returning from Dropbox OAuth redirect?
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');

        if (code) {
            const verifier = window.sessionStorage.getItem('keim_pkce_verifier');
            if (verifier) auth.setCodeVerifier(verifier);
            try {
                const response = await auth.getAccessTokenFromCode(this.getRedirectUri(), code);
                const result = response.result as unknown as DropboxTokenResponse;
                if (result.refresh_token) {
                    localStorage.setItem('keim_dropbox_refresh', result.refresh_token);
                    auth.setRefreshToken(result.refresh_token);
                }
                this.dbx = new Dropbox({ auth });
                window.sessionStorage.removeItem('keim_pkce_verifier');
                window.history.replaceState({}, document.title, window.location.pathname);
                return true;
            } catch (e) {
                console.error('Failed to exchange PKCE code', e);
                localStorage.removeItem('keim_dropbox_refresh');
            }
        }

        // 2. Saved refresh token?
        const savedRefresh = localStorage.getItem('keim_dropbox_refresh');
        if (savedRefresh) {
            auth.setRefreshToken(savedRefresh);
            this.dbx = new Dropbox({ auth });
            return true;
        }

        return false;
    }

    async login(): Promise<void> {
        const auth = this.getDbxAuth();
        if (!auth) throw new Error('Dropbox App Key is not configured.');
        const authUrl = await auth.getAuthenticationUrl(
            this.getRedirectUri(),
            undefined,
            'code',
            'offline',
            undefined,
            'none',
            true // PKCE
        );
        window.sessionStorage.setItem('keim_pkce_verifier', auth.getCodeVerifier());
        window.location.href = authUrl.toString();
    }

    disconnect(): void {
        this.dbxAuth = null;
        this.dbx = null;
        this.folderChecked = false;
        localStorage.removeItem('keim_dropbox_refresh');
    }

    isConnected(): boolean {
        return !!this.dbx;
    }
    
    // Auth Check: We expose this for Provider-specific health checks if needed,
    // though the interface doesn't strictly require it. We will use it internally if we want.
    async checkAuthHealth(): Promise<boolean> {
        if (!this.dbx) return false;
        try {
            await this.dbx.usersGetCurrentAccount();
            return true;
        } catch (e) {
            const error = e as { status?: number; response?: { status?: number } };
            const status = error?.status || error?.response?.status;
            if (status === 400 || status === 401) {
                this.disconnect();
                return false;
            }
            throw new Error('Could not reach Dropbox. Please try again.');
        }
    }

    async ensureAppFolder(): Promise<void> {
        if (!this.dbx || this.folderChecked) return;
        try {
            await this.dbx.filesCreateFolderV2({ path: APP_ROOT, autorename: false });
        } catch (e) {
            const error = e as { status?: number; response?: { status?: number }; error?: { error_summary?: string } };
            const status = error?.status || error?.response?.status;
            const errSummary = error?.error?.error_summary || '';
            if (status === 409 || errSummary.includes('path/conflict')) {
                // Expected — folder exists
            } else {
                console.warn('Sync: Could not ensure app folder:', e);
            }
        }
        this.folderChecked = true;
    }

    async downloadFile(relativePath: string, retryCount = 0): Promise<Blob | null> {
        if (!this.dbx) return null;
        // ensure leading slash
        const normalizedPath = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
        const fullPath = `${APP_ROOT}${normalizedPath}`;
        try {
            const response = await this.dbx.filesDownload({ path: fullPath });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (response.result as any).fileBlob;
        } catch (e) {
            const error = e as { status?: number; response?: { status?: number; headers?: { get: (h: string) => string | null } }; error?: { error_summary?: string } };
            if (error instanceof TypeError && retryCount < 2) {
                await new Promise(r => setTimeout(r, 3000));
                return this.downloadFile(relativePath, retryCount + 1);
            }
            const status = error?.status || error?.response?.status;
            const summary = error?.error?.error_summary || '';
            if (status === 409 || status === 404 || summary.includes('path/not_found')) {
                return null;
            }
            if (status === 429 && retryCount < 3) {
                const retryAfter = error?.response?.headers?.get('retry-after') || 2;
                await new Promise(r => setTimeout(r, Number(retryAfter) * 1000));
                return this.downloadFile(relativePath, retryCount + 1);
            }
            throw error;
        }
    }

    async uploadFile(relativePath: string, content: string | Blob, retryCount = 0): Promise<void> {
        if (!this.dbx) return;
        const normalizedPath = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
        const fullPath = `${APP_ROOT}${normalizedPath}`;
        try {
            await this.dbx.filesUpload({
                path: fullPath,
                // The Dropbox SDK types are slightly strict, but they accept string | Blob.
                contents: content as any,
                mode: { '.tag': 'overwrite' }
            });
        } catch (e) {
            const error = e as { status?: number; response?: { status?: number; headers?: { get: (h: string) => string | null } } };
            if (error instanceof TypeError && retryCount < 2) {
                await new Promise(r => setTimeout(r, 3000));
                return this.uploadFile(relativePath, content, retryCount + 1);
            }
            const status = error?.status || error?.response?.status;
            if (status === 429 && retryCount < 3) {
                const retryAfter = error?.response?.headers?.get('retry-after') || 2;
                await new Promise(r => setTimeout(r, Number(retryAfter) * 1000));
                return this.uploadFile(relativePath, content, retryCount + 1);
            }
            throw error;
        }
    }

    async deleteFile(relativePath: string): Promise<void> {
        if (!this.dbx) return;
        const normalizedPath = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
        const fullPath = `${APP_ROOT}${normalizedPath}`;
        try {
            await this.dbx.filesDeleteV2({ path: fullPath });
        } catch (e) {
            const error = e as { status?: number; response?: { status?: number }; error?: { error_summary?: string } };
            const status = error?.status || error?.response?.status;
            const summary = error?.error?.error_summary || '';
            if (status === 404 || summary.includes('path/not_found')) {
                return; // Already deleted
            }
            throw error;
        }
    }
}
