/**
 * src/lib/crypto.ts
 * Cryptography utilities using the Web Crypto API.
 * 
 * Keim E2EE Security Model
 * 
 * Overview:
 * Notes and metadata are encrypted client-side using a Document Encryption Key (DEK). 
 * The DEK is generated locally using `crypto.getRandomValues`.
 * 
 * Key Derivation (PBKDF2):
 * A master vault password derives the Key Encryption Key (KEK) using PBKDF2 
 * with 250,000 iterations of SHA-256 and a random 16-byte salt (or 100k depending on the setup constraint). 
 * This protects against brute-force attacks on the user's password.
 * 
 * Key Wrapping (AES-GCM):
 * The raw DEK is never stored. It is wrapped (encrypted) by the KEK using AES-256-GCM. 
 * This wrapped payload (wrapped DEK, IV, and Salt) is uploaded to `/.keim_keys`.
 * 
 * Authentication & Decryption (AES-GCM):
 * All note content is encrypted and authenticated with AES-256-GCM.
 * A unique 12-byte IV is prepended to the ciphertext.
 * The application currently holds the unwrapped DEK in memory (`useAppStore.activeDEK`) 
 * only for the duration of the authenticated session. 
 * On page reload, the user must re-enter their password to unlock the encrypted payload.
 */

const CRYPTO_ALGO = 'AES-GCM';
const KEY_LENGTH = 256;
const ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/**
 * ArrayBuffer and Base64 Conversion Helpers
 */
export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
    const binary = window.atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Key Generation & Derivation
 */
export function generateSalt(): Uint8Array {
    return window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

export async function deriveKEK(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );

    return await window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as any,
            iterations: ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: CRYPTO_ALGO, length: KEY_LENGTH },
        true,
        ['wrapKey', 'unwrapKey']
    );
}

export async function generateDEK(): Promise<CryptoKey> {
    return window.crypto.subtle.generateKey(
        { name: CRYPTO_ALGO, length: KEY_LENGTH },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encryption / Decryption
 */
export async function encryptTextToBuffer(text: string, dek: CryptoKey): Promise<{ ciphertext: ArrayBuffer, iv: Uint8Array }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(text);
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: CRYPTO_ALGO, iv: iv as any },
        dek,
        encoded
    );
    return { ciphertext, iv };
}

export async function decryptTextFromBuffer(ciphertext: ArrayBuffer, iv: Uint8Array, dek: CryptoKey): Promise<string> {
    const decrypted = await window.crypto.subtle.decrypt(
        { name: CRYPTO_ALGO, iv: iv as any },
        dek,
        ciphertext
    );
    return new TextDecoder().decode(decrypted);
}

/**
 * Key Wrapping
 */
export async function wrapKey(keyToWrap: CryptoKey, kek: CryptoKey): Promise<{ wrappedKey: ArrayBuffer, iv: Uint8Array }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const wrappedKey = await window.crypto.subtle.wrapKey(
        'raw',
        keyToWrap,
        kek,
        { name: CRYPTO_ALGO, iv: iv as any }
    );
    return { wrappedKey, iv };
}

export async function unwrapKey(wrappedKey: ArrayBuffer, iv: Uint8Array, kek: CryptoKey): Promise<CryptoKey> {
    return await window.crypto.subtle.unwrapKey(
        'raw',
        wrappedKey,
        kek,
        { name: CRYPTO_ALGO, iv: iv as any },
        { name: CRYPTO_ALGO, length: KEY_LENGTH },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * Export/Import DEK for session storage
 */
export async function exportDEK(dek: CryptoKey): Promise<ArrayBuffer> {
    return window.crypto.subtle.exportKey('raw', dek);
}

export async function importDEK(rawKey: ArrayBuffer): Promise<CryptoKey> {
    return window.crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: CRYPTO_ALGO },
        true,
        ['encrypt', 'decrypt']
    );
}
