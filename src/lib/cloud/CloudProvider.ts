/// <reference types="vite/client" />

export interface CloudProvider {
    /** 
     * Unique identifier for the provider (e.g., 'dropbox', 'onedrive') 
     */
    id: string;
    
    /** 
     * Human-readable name (e.g., 'Dropbox') 
     */
    name: string;
    
    // Auth & Connection
    
    /** 
     * Check if the user is authorized, returning true if they are.
     * Often handles silent token refreshes or parsing auth hashes from URL.
     */
    authorize(): Promise<boolean>;
    
    /** 
     * Trigger the full login flow (e.g. redirecting to an OAuth page).
     */
    login(): Promise<void>;
    
    /** 
     * Disconnect the provider and clear local auth tokens.
     */
    disconnect(): void;
    
    /** 
     * Fast synchronous check if the app considers the provider connected.
     */
    isConnected(): boolean;
    
    // Setup
    
    /** 
     * Ensure the necessary sync directory (e.g., `/keim/`) exists on the cloud.
     */
    ensureAppFolder(): Promise<void>;
    
    // Transport
    
    /** 
     * Download a file from the app directory. Returns null if missing.
     * @param path Relative path, e.g. "manifest.json"
     */
    downloadFile(path: string): Promise<Blob | null>;
    
    /** 
     * Upload or overwrite a file in the app directory.
     * @param path Relative path, e.g. "manifest.json"
     * @param content The contents to upload
     */
    uploadFile(path: string, content: string | Blob): Promise<void>;
    
    /** 
     * Delete a file from the app directory.
     * @param path Relative path
     */
    deleteFile(path: string): Promise<void>;
    
    /**
     * Check if the vault has been encrypted
     */
    checkVaultState?(): Promise<'EMPTY' | 'UNENCRYPTED' | 'LOCKED' | 'UNLOCKED'>;
}
