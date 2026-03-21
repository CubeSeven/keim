import { describe, it, expect } from 'vitest';
import {
    encryptTextToBuffer,
    decryptTextFromBuffer,
    deriveKEK,
    generateDEK,
    wrapKey,
    unwrapKey,
    generateSalt
} from '../crypto';

describe('crypto.ts Web Crypto API Wrapper', () => {

    it('should generate valid 16-byte random salts', () => {
        const salt1 = generateSalt();
        const salt2 = generateSalt();
        
        expect(salt1.byteLength).toBe(16);
        expect(salt2.byteLength).toBe(16);
        // Extremely low probability of collision
        expect(salt1).not.toEqual(salt2);
    });

    describe('Text Encryption (AES-GCM)', () => {
        it('should round-trip encrypt and decrypt UTF-8 text', async () => {
            const dek = await generateDEK();
            const plaintext = "Hello World! 🔐 with emoji";
            
            const { ciphertext, iv } = await encryptTextToBuffer(plaintext, dek);
            expect(ciphertext.byteLength).toBeGreaterThan(0);
            
            const decryptedText = await decryptTextFromBuffer(ciphertext, iv, dek);
            expect(decryptedText).toBe(plaintext);
        });

        it('should throw when decrypting with the wrong key', async () => {
            const dek1 = await generateDEK();
            const dek2 = await generateDEK(); // different key
            const plaintext = "Top Secret";
            
            const { ciphertext, iv } = await encryptTextToBuffer(plaintext, dek1);
            
            await expect(decryptTextFromBuffer(ciphertext, iv, dek2)).rejects.toThrow();
        });

        it('should throw when ciphertext buffer is tampered or truncated', async () => {
            const dek = await generateDEK();
            const { ciphertext, iv } = await encryptTextToBuffer("Data", dek);
            
            // Truncate the buffer (removes the GCM auth tag)
            const tampered = ciphertext.slice(0, ciphertext.byteLength - 4);
            
            await expect(decryptTextFromBuffer(tampered, iv, dek)).rejects.toThrow();
        });
    });

    describe('Key Derivation and Wrapping (PBKDF2 + AES-KW)', () => {
        it('deriveKEK should produce stable output for same password and salt', async () => {
            const password = "my-secure-password";
            const salt = generateSalt();
            
            const kek1 = await deriveKEK(password, salt);
            const kek2 = await deriveKEK(password, salt);
            
            // We can't directly compare CryptoKey instances, but we can verify behavior
            // by using both KEKs to wrap and unwrap a known key.
            const dek = await generateDEK();
            const { wrappedKey, iv } = await wrapKey(dek, kek1);
            
            // If kek2 is identical, it should successfully unwrap what kek1 wrapped
            const unwrappedDek = await unwrapKey(wrappedKey, iv, kek2);
            expect(unwrappedDek.algorithm.name).toBe('AES-GCM');
        });

        it('should successfully round-trip wrap and unwrap a DEK', async () => {
            const salt = generateSalt();
            const kek = await deriveKEK("password123", salt);
            const dek = await generateDEK();
            
            const { wrappedKey, iv } = await wrapKey(dek, kek);
            
            // wrapped key should be a 32-byte key exported + 16 bytes GCM auth tag -> 48 bytes
            expect(wrappedKey.byteLength).toBe(48);
            expect(iv.byteLength).toBe(12); // AES-GCM IV is 12 bytes
            
            const unwrappedDek = await unwrapKey(wrappedKey, iv, kek);
            
            // Verify unwrapped key works
            const plaintext = "Verification text";
            const { ciphertext, iv: cipherIv } = await encryptTextToBuffer(plaintext, unwrappedDek);
            const output = await decryptTextFromBuffer(ciphertext, cipherIv, dek); // decrypt with original DEK
            
            expect(output).toBe(plaintext);
        });

        it('should throw when unwrapping with wrong KEK (wrong password)', async () => {
            const salt = generateSalt();
            const wrongKek = await deriveKEK("wrong-password", salt);
            const rightKek = await deriveKEK("correct-password", salt);
            const dek = await generateDEK();
            
            const { wrappedKey, iv } = await wrapKey(dek, rightKek);
            
            await expect(unwrapKey(wrappedKey, iv, wrongKek)).rejects.toThrow();
        });
    });

});
