/**
 * src/lib/biometrics.ts
 * 
 * Implements hardware-backed biometric unlock using the WebAuthn PRF extension.
 * This allows user to unlock their E2EE vault without re-typing their password.
 */

import { KEYS } from './constants';
import { base64ToBuffer, bufferToBase64, unwrapKey, wrapKey } from './crypto';

const SALT_STRING = "keim-vault-bio-unlock-v1";
const CRYPTO_ALGO = 'AES-GCM';
const KEY_LENGTH = 256;

/**
 * Structured result type for enrollBiometric.
 */
export type EnrollResult =
    | { success: true }
    | { success: false; reason: 'prf_unsupported' | 'cancelled' | 'unknown' };

/**
 * Helper: Derive the 32-byte salt for the PRF extension using SHA-256
 */
async function getPrfSalt(): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const data = encoder.encode(SALT_STRING);
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hash);
}

/**
 * Check if the browser supports WebAuthn with the PRF extension and has a platform authenticator.
 */
export async function isBiometricAvailable(): Promise<boolean> {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) {
        return false;
    }
    
    // Check if platform authenticator (FaceID, TouchID, Windows Hello) is available
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!available) return false;
    } else {
        return false;
    }
    
    return true;
}

/**
 * Derive an AES-GCM wrapping key using HKDF from the raw PRF output.
 */
async function deriveWrappingKeyFromPrf(prfOutput: ArrayBuffer): Promise<CryptoKey> {
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        prfOutput,
        { name: 'HKDF' },
        false,
        ['deriveKey']
    );

    return await window.crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(16),
            info: new TextEncoder().encode('keim-bio-wrap-key')
        },
        keyMaterial,
        { name: CRYPTO_ALGO, length: KEY_LENGTH },
        true,
        ['wrapKey', 'unwrapKey']
    );
}

/**
 * Enroll a new biometric passkey and wrap the provided DEK with it.
 * 
 * IMPORTANT: Always re-enrolls by performing credentials.create() then credentials.get()
 * for consistent behaviour across all browsers (2 biometric prompts during setup only).
 * IMPORTANT: Always call revokeBiometric() before calling this if re-enrolling,
 * and always call this again if the DEK is ever regenerated.
 */
export async function enrollBiometric(dek: CryptoKey): Promise<EnrollResult> {
    // Issue #9: Defensive null check
    if (!dek) return { success: false, reason: 'unknown' };

    try {
        if (!await isBiometricAvailable()) return { success: false, reason: 'unknown' };

        const salt = await getPrfSalt();
        const userId = window.crypto.getRandomValues(new Uint8Array(16));
        
        const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
            challenge: window.crypto.getRandomValues(new Uint8Array(32)),
            rp: {
                name: "Keim Notes Vault",
            },
            user: {
                id: userId,
                name: "Vault Owner",
                displayName: "Vault Owner"
            },
            pubKeyCredParams: [
                { alg: -7, type: "public-key" },  // ES256
                { alg: -257, type: "public-key" }  // RS256
            ],
            authenticatorSelection: {
                authenticatorAttachment: "platform",
                requireResidentKey: true,
                userVerification: "required"
            },
            extensions: {
                prf: { eval: { first: salt } }
            } as any
        };

        // Prompt 1: Register the passkey
        const credential = await navigator.credentials.create({
            publicKey: publicKeyCredentialCreationOptions
        }) as any;

        if (!credential) return { success: false, reason: 'unknown' };

        const prfResults = credential.getClientExtensionResults()?.prf;
        if (!prfResults || !prfResults.enabled) {
            // Issue #3: Specific reason for PRF not supported
            console.warn("PRF extension not supported by the authenticator.");
            return { success: false, reason: 'prf_unsupported' };
        }

        // Issue #2: Always do a get() call for consistent cross-browser behaviour.
        // Some browsers return PRF output on create(), others don't — always using get()
        // ensures exactly 2 prompts on every device without any conditional branching.
        const getOptions: PublicKeyCredentialRequestOptions = {
            challenge: window.crypto.getRandomValues(new Uint8Array(32)),
            allowCredentials: [{
                id: credential.rawId,
                type: 'public-key'
            }],
            userVerification: "required",
            extensions: {
                prf: { eval: { first: salt } }
            } as any
        };

        // Prompt 2: Retrieve the PRF output (cryptographic key material)
        const assertion = await navigator.credentials.get({ publicKey: getOptions }) as any;
        const assertionPrf = assertion.getClientExtensionResults()?.prf;
        if (!assertionPrf?.results?.first) {
            throw new Error("Failed to get PRF output from authenticator.");
        }
        const prfOutput = assertionPrf.results.first;

        // Derive the wrapping key and wrap the DEK
        const wrappingKey = await deriveWrappingKeyFromPrf(prfOutput);
        const { wrappedKey, iv } = await wrapKey(dek, wrappingKey);

        const payload = {
            credentialId: bufferToBase64(credential.rawId),
            wrappedDEK: bufferToBase64(wrappedKey),
            iv: bufferToBase64(iv)
        };

        localStorage.setItem(KEYS.BIO_CREDENTIAL, JSON.stringify(payload));
        return { success: true };

    } catch (e: any) {
        // Issue #3: Distinguish user cancel from other failures
        if (e?.name === 'NotAllowedError') {
            return { success: false, reason: 'cancelled' };
        }
        console.error("Biometric enrollment failed:", e);
        return { success: false, reason: 'unknown' };
    }
}

/**
 * Attempt to unlock the vault using a previously enrolled biometric passkey.
 * 
 * Throws a NotAllowedError if the user explicitly cancels — callers should
 * handle this silently (no error message shown). Returns null on other failures.
 */
export async function unlockWithBiometric(): Promise<CryptoKey | null> {
    const storedBioStr = localStorage.getItem(KEYS.BIO_CREDENTIAL);
    if (!storedBioStr) return null;

    // Issue #4: Specifically catch and auto-revoke corrupted localStorage data
    let storedBio: { credentialId: string; wrappedDEK: string; iv: string };
    try {
        storedBio = JSON.parse(storedBioStr);
    } catch {
        console.warn("Biometric credential data is corrupted. Auto-revoking.");
        revokeBiometric();
        return null;
    }

    if (!storedBio.credentialId || !storedBio.wrappedDEK || !storedBio.iv) {
        console.warn("Biometric credential data is incomplete. Auto-revoking.");
        revokeBiometric();
        return null;
    }

    try {
        const salt = await getPrfSalt();
        const credentialId = base64ToBuffer(storedBio.credentialId);

        const getOptions: PublicKeyCredentialRequestOptions = {
            challenge: window.crypto.getRandomValues(new Uint8Array(32)),
            allowCredentials: [{
                id: credentialId,
                type: 'public-key'
            }],
            userVerification: "required",
            extensions: {
                prf: { eval: { first: salt } }
            } as any
        };

        const assertion = await navigator.credentials.get({ publicKey: getOptions }) as any;
        if (!assertion) return null;

        const prfResults = assertion.getClientExtensionResults()?.prf;
        if (!prfResults?.results?.first) {
            console.warn("Authentication succeeded but PRF output missing.");
            return null;
        }

        const prfOutput = prfResults.results.first;
        const wrappingKey = await deriveWrappingKeyFromPrf(prfOutput);

        const wrappedDEK = base64ToBuffer(storedBio.wrappedDEK);
        const iv = base64ToBuffer(storedBio.iv);
        const dek = await unwrapKey(wrappedDEK, new Uint8Array(iv), wrappingKey);
        return dek;

    } catch (e: any) {
        // Issue #7: Re-throw NotAllowedError so the caller can silently handle user cancellation.
        // Do NOT show an error message when the user simply cancels the prompt.
        if (e?.name === 'NotAllowedError') {
            throw e;
        }
        console.warn("Biometric unlock failed:", e);
        return null;
    }
}

/**
 * Revoke the biometric credential from local storage.
 * Note: The passkey entry may remain in the device's credential manager
 * and must be removed manually via device Settings → Passwords/Passkeys.
 */
export function revokeBiometric(): void {
    localStorage.removeItem(KEYS.BIO_CREDENTIAL);
}
