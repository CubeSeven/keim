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
    
    // Check if PRF extension is conceptually supported (we can't 100% know until we try create/get,
    // but we can check if the extension API is defined in some environments, though the safest
    // is just relying on the creation step returning the extension results).
    // For now, if WebAuthn is there and we have a platform authenticator, we assume we can try PRF.
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
            salt: new Uint8Array(16), // Empty salt is fine here since PRF output is already high entropy
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
 */
export async function enrollBiometric(dek: CryptoKey): Promise<boolean> {
    try {
        if (!await isBiometricAvailable()) return false;

        const salt = await getPrfSalt();
        const userId = window.crypto.getRandomValues(new Uint8Array(16));
        
        const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
            challenge: window.crypto.getRandomValues(new Uint8Array(32)),
            rp: {
                name: "Keim Notes Vault",
                // RP ID defaults to the current origin's effective domain
            },
            user: {
                id: userId,
                name: "Vault Owner",
                displayName: "Vault Owner"
            },
            pubKeyCredParams: [
                { alg: -7, type: "public-key" }, // ES256
                { alg: -257, type: "public-key" } // RS256
            ],
            authenticatorSelection: {
                authenticatorAttachment: "platform",
                requireResidentKey: true,
                userVerification: "required"
            },
            extensions: {
                prf: {
                    eval: {
                        first: salt
                    }
                }
            } as any // Cast is needed because PRF might not be in the TS lib yet
        };

        const credential = await navigator.credentials.create({
            publicKey: publicKeyCredentialCreationOptions
        }) as any;

        if (!credential) return false;

        const prfResults = credential.getClientExtensionResults()?.prf;
        
        if (!prfResults || !prfResults.enabled) {
            console.warn("PRF extension not supported by the authenticator.");
            return false;
        }

        // We need to re-authenticate immediately to get the PRF output used for encryption,
        // because the 'create' call only ensures the PRF extension is enabled, it may not
        // return the eval results directly in all browser implementations.
        // Actually, some browsers (Chrome 116+) return it on creation if requested. Let's try to use it if present,
        // otherwise we must perform a 'get' call.
        let prfOutput = prfResults.results?.first;
        
        if (!prfOutput) {
             const getOptions: PublicKeyCredentialRequestOptions = {
                 challenge: window.crypto.getRandomValues(new Uint8Array(32)),
                 allowCredentials: [{
                     id: credential.rawId,
                     type: 'public-key'
                 }],
                 userVerification: "required",
                 extensions: {
                     prf: {
                         eval: {
                             first: salt
                         }
                     }
                 } as any
             };
             const assertion = await navigator.credentials.get({ publicKey: getOptions }) as any;
             const assertionPrf = assertion.getClientExtensionResults()?.prf;
             if (!assertionPrf || !assertionPrf.results || !assertionPrf.results.first) {
                 throw new Error("Failed to get PRF output from authenticator.");
             }
             prfOutput = assertionPrf.results.first;
        }

        // Derive the wrapping key
        const wrappingKey = await deriveWrappingKeyFromPrf(prfOutput);
        
        // Wrap the raw DEK
        const { wrappedKey, iv } = await wrapKey(dek, wrappingKey);

        // Store credential ID and wrapped payload
        const credentialIdBase64 = bufferToBase64(credential.rawId);
        
        const payload = {
            credentialId: credentialIdBase64,
            wrappedDEK: bufferToBase64(wrappedKey),
            iv: bufferToBase64(iv)
        };

        localStorage.setItem(KEYS.BIO_CREDENTIAL, JSON.stringify(payload));
        return true;
    } catch (e) {
        console.error("Biometric enrollment failed:", e);
        return false;
    }
}

/**
 * Attempt to unlock the vault using a previously enrolled biometric passkey.
 */
export async function unlockWithBiometric(): Promise<CryptoKey | null> {
    try {
        const storedBioStr = localStorage.getItem(KEYS.BIO_CREDENTIAL);
        if (!storedBioStr) return null;

        const storedBio = JSON.parse(storedBioStr);
        if (!storedBio.credentialId || !storedBio.wrappedDEK || !storedBio.iv) return null;

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
                prf: {
                    eval: {
                        first: salt
                    }
                }
            } as any
        };

        const assertion = await navigator.credentials.get({ publicKey: getOptions }) as any;
        if (!assertion) return null;

        const prfResults = assertion.getClientExtensionResults()?.prf;
        if (!prfResults || !prfResults.results || !prfResults.results.first) {
            console.warn("Authentication succeeded but PRF output missing.");
            return null;
        }

        const prfOutput = prfResults.results.first;
        
        // Derive the wrapping key
        const wrappingKey = await deriveWrappingKeyFromPrf(prfOutput);

        // Unwrap the DEK
        const wrappedDEK = base64ToBuffer(storedBio.wrappedDEK);
        const iv = base64ToBuffer(storedBio.iv);

        const dek = await unwrapKey(wrappedDEK, new Uint8Array(iv), wrappingKey);
        return dek;
        
    } catch (e) {
        // User may have cancelled or verification failed
        console.warn("Biometric unlock failed or was cancelled:", e);
        return null;
    }
}

/**
 * Revoke the biometric credential from local storage.
 */
export function revokeBiometric(): void {
    localStorage.removeItem(KEYS.BIO_CREDENTIAL);
}
