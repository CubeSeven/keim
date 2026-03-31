import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, KeyRound, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../store';
import { deriveKEK, generateDEK, wrapKey, unwrapKey, generateSalt, bufferToBase64, base64ToBuffer } from '../lib/crypto';
import { unlockWithBiometric, isBiometricAvailable, revokeBiometric } from '../lib/biometrics';
import { getCloudProvider } from '../lib/cloud/ProviderManager';
import { syncNotesWithDrive, resetLocalSyncState } from '../lib/sync';
import { KEYS } from '../lib/constants';

export default function E2EEVaultModal() {
    const { e2eeModalState, setE2eeModalState, setActiveDEK, setIsE2EESkipped, isBiometricEnrolled, setIsBiometricEnrolled } = useAppStore();
    const { isOpen, mode } = e2eeModalState;

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [understood, setUnderstood] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [attempts, setAttempts] = useState(0);
    const [lockoutUntil, setLockoutUntil] = useState<number>(0);
    const isLockedOut = Date.now() < lockoutUntil;

    const [bioAvailable, setBioAvailable] = useState(false);
    // isAutoTriggering: true from the moment the modal opens (bio enrolled) until the
    // biometric attempt resolves — ensures the spinner shows immediately, no form flash.
    const [isAutoTriggering, setIsAutoTriggering] = useState(false);

    useEffect(() => {
        isBiometricAvailable().then(setBioAvailable);
    }, []);

    // Auto-trigger biometric when modal opens in unlock mode — single prompt, no double-auth
    useEffect(() => {
        if (isOpen && mode === 'unlock' && isBiometricEnrolled) {
            setIsAutoTriggering(true);
            isBiometricAvailable().then(available => {
                if (available) {
                    handleBioUnlock();
                } else {
                    setIsAutoTriggering(false);
                }
            });
        } else {
            setIsAutoTriggering(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const closeModal = () => {
        if (processing) return;
        setE2eeModalState({ isOpen: false, mode });
        setPassword('');
        setConfirmPassword('');
        setUnderstood(false);
        setError(null);
    };

    const handleSetup = async () => {
        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }
        if (password.length < 12) {
            setError('Password must be at least 12 characters.');
            return;
        }
        if (!understood) {
            setError('Please confirm you understand the recovery warning.');
            return;
        }

        setProcessing(true);
        setError(null);
        try {
            const salt = generateSalt();
            const kek = await deriveKEK(password, salt);
            const dek = await generateDEK();
            
            // Generate the wrapped key to be uploaded later
            const { wrappedKey, iv } = await wrapKey(dek, kek);

            const payload = {
                wrappedDEK: bufferToBase64(wrappedKey),
                iv: bufferToBase64(iv),
                salt: bufferToBase64(salt)
            };
            
            // SECURITY PURGE: Wipe legacy plaintext files from the cloud to prevent data leakage 
            // when converting an existing unencrypted vault to E2EE.
            console.log('Purging legacy plaintext artifacts from cloud...');
            const provider = getCloudProvider();
            await Promise.allSettled([
                provider.deleteFile('/items'),
                provider.deleteFile('/contents'),
                provider.deleteFile('/manifest.json'),
                provider.deleteFile('/schemas.json')
            ]);

            // Now upload the secure master key enclosure
            await provider.uploadFile('/.keim_keys', JSON.stringify(payload));
            
            // Store the wrapped JSON payload in local storage (never the raw DEK)
            localStorage.setItem(KEYS.ACTIVE_DEK, JSON.stringify(payload));

            // IMPORTANT: Always revoke biometrics when the DEK is regenerated.
            // The BIO_CREDENTIAL wraps the DEK at enrollment time — if setup runs
            // again, a new DEK is created and the old biometric credential becomes invalid.
            revokeBiometric();
            setIsBiometricEnrolled(false);

            setActiveDEK(dek);

            // Reset local sync state so the sync engine performs a full cryptographic re-upload
            resetLocalSyncState();

            closeModal();
            // Trigger a manual sync which will now use the DEK
            setTimeout(() => syncNotesWithDrive(), 100);
        } catch (e) {
            setError('Cryptographic setup failed.');
            console.error(e);
        } finally {
            setProcessing(false);
        }
    };

    const handleUnlock = async () => {
        if (isLockedOut) {
            setError('Too many failed attempts. Please wait.');
            return;
        }
        if (!password) {
            setError('Please enter your password.');
            return;
        }

        setProcessing(true);
        setError(null);
        try {
            let keysData;
            const savedPayload = localStorage.getItem(KEYS.ACTIVE_DEK);
            if (savedPayload && savedPayload.startsWith('{')) {
                keysData = JSON.parse(savedPayload);
            } else {
                const keysBlob = await getCloudProvider().downloadFile('/.keim_keys');
                if (!keysBlob) throw new Error("Could not find .keim_keys on cloud.");
                keysData = JSON.parse(await keysBlob.text());
                localStorage.setItem(KEYS.ACTIVE_DEK, JSON.stringify(keysData));
            }

            const salt = base64ToBuffer(keysData.salt);
            const iv = base64ToBuffer(keysData.iv);
            const wrappedDEK = base64ToBuffer(keysData.wrappedDEK);

            const kek = await deriveKEK(password, new Uint8Array(salt));
            const dek = await unwrapKey(wrappedDEK, new Uint8Array(iv), kek);

            localStorage.setItem(KEYS.ACTIVE_DEK, JSON.stringify(keysData)); // Ensure it's stored for next offline boot
            setActiveDEK(dek);
            setAttempts(0);
            closeModal();
            setTimeout(() => syncNotesWithDrive(), 100);
        } catch (e) {
            setAttempts(a => a + 1);
            if (attempts + 1 >= 5) {
                setLockoutUntil(Date.now() + 60000); // 1 minute
                setAttempts(0);
                setError('Too many failed attempts. Try again in 1 minute.');
            } else {
                setError(`Incorrect password. ${5 - (attempts + 1)} attempts left.`);
            }
            console.error(e);
        } finally {
            setProcessing(false);
        }
    };

    const handleBioUnlock = async () => {
        setProcessing(true);
        setError(null);
        try {
            const dek = await unlockWithBiometric();
            if (dek) {
                setActiveDEK(dek);
                setAttempts(0);
                closeModal();
                setTimeout(() => syncNotesWithDrive(), 100);
            } else {
                // Issue #4: If credential was auto-revoked due to corruption, sync the store
                if (!localStorage.getItem(KEYS.BIO_CREDENTIAL)) {
                    setIsBiometricEnrolled(false);
                }
                setError('Biometric verification failed. Please use your password instead.');
            }
        } catch (e: any) {
            // Issue #7: NotAllowedError = user cancelled the prompt. Show no error — just
            // restore the form cleanly so the user can enter their password.
            if (e?.name === 'NotAllowedError') {
                setError(null);
            } else {
                setError('Biometric error. Please use your password instead.');
            }
        } finally {
            setProcessing(false);
            setIsAutoTriggering(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-dark-bg/60 dark:bg-dark-bg/60 backdrop-blur-md"
                        onClick={closeModal}
                        aria-hidden="true"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="relative w-full max-w-sm bg-light-bg/95 dark:bg-dark-bg/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-light-ui dark:border-white/10 overflow-hidden flex flex-col"
                    >
                        <div className="p-6 md:p-8 space-y-6 text-dark-bg dark:text-light-bg">
                            {/* Header */}
                            <div className="flex flex-col items-center text-center space-y-3">
                                <div className="w-14 h-14 rounded-2xl bg-dark-bg/5 dark:bg-white/5 flex items-center justify-center text-dark-bg dark:text-light-bg border border-dark-bg/10 dark:border-white/10">
                                    {mode === 'setup' ? <ShieldAlert size={28} /> : <Lock size={28} />}
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold tracking-tight">
                                        {mode === 'setup' ? 'Enable Encryption' : 'Vault Locked'}
                                    </h2>
                                    <p className="text-xs opacity-70 mt-1 leading-relaxed px-2">
                                        {mode === 'setup' 
                                            ? 'Secure your notes with End-to-End Encryption before syncing to Dropbox.' 
                                            : 'This Dropbox folder is encrypted. Enter your password to unlock the notes.'}
                                    </p>
                                </div>
                            </div>

                            {/* Form */}
                            <div className="space-y-4">
                                <div className="space-y-3">
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-3 flex items-center opacity-50">
                                            <KeyRound size={16} />
                                        </div>
                                        <input
                                            type="password"
                                            placeholder="Vault Password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-dark-bg/5 dark:bg-white/5 border border-dark-bg/10 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-dark-bg/40 dark:placeholder:text-light-bg/40 text-dark-bg dark:text-light-bg"
                                        />
                                    </div>
                                    
                                    {mode === 'setup' && (
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-3 flex items-center opacity-50">
                                                <KeyRound size={16} />
                                            </div>
                                            <input
                                                type="password"
                                                placeholder="Confirm Password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                className="w-full pl-10 pr-4 py-3 bg-dark-bg/5 dark:bg-white/5 border border-dark-bg/10 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-dark-bg/40 dark:placeholder:text-light-bg/40 text-dark-bg dark:text-light-bg"
                                            />
                                        </div>
                                    )}
                                </div>

                                {mode === 'setup' && (
                                    <label className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/10 cursor-pointer group">
                                        <div className="mt-0.5 relative flex items-center justify-center w-4 h-4 rounded border border-red-500/30 group-hover:border-red-500/50 transition-colors shrink-0">
                                            <input 
                                                type="checkbox" 
                                                checked={understood}
                                                onChange={(e) => setUnderstood(e.target.checked)}
                                                className="absolute w-full h-full opacity-0 cursor-pointer" 
                                            />
                                            {understood && <CheckCircle2 size={12} className="text-red-500 pointer-events-none" />}
                                        </div>
                                        <p className="text-[10px] leading-relaxed opacity-80 text-red-600 dark:text-red-400 font-medium select-none">
                                            I understand that if I lose this password, Keim cannot restore it, and my synced notes will be permanently lost.
                                        </p>
                                    </label>
                                )}

                                {error && (
                                    <p className="text-xs font-semibold text-red-500 text-center animate-in fade-in slide-in-from-top-1">{error}</p>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="grid gap-2 pt-2">
                                {processing || isAutoTriggering ? (
                                    <div className="flex items-center justify-center py-6 text-dark-bg dark:text-white">
                                        <l-mirage size="40" speed="2.5" color="currentColor" />
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            disabled={isLockedOut}
                                            onClick={mode === 'setup' ? handleSetup : handleUnlock}
                                            className="w-full flex items-center justify-center py-3 rounded-xl font-bold text-sm bg-dark-bg text-white dark:bg-white dark:text-dark-bg hover:opacity-90 shadow-lg shadow-black/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {mode === 'setup' ? 'Enable & Sync' : 'Unlock Vault'}
                                        </button>
                                        
                                        {mode === 'unlock' && bioAvailable && isBiometricEnrolled && (
                                            <button
                                                disabled={isLockedOut}
                                                onClick={handleBioUnlock}
                                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-indigo-500/20"
                                            >
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 11h.01"/><path d="M15 15h.01"/><path d="M15 11h.01"/><path d="M15 7h.01"/><path d="M12 15h.01"/><path d="M12 7h.01"/><path d="M9 15h.01"/><path d="M9 11h.01"/><path d="M9 7h.01"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/></svg>
                                                Unlock with Biometrics
                                            </button>
                                        )}

                                        <button
                                            onClick={mode === 'setup' ? () => { setIsE2EESkipped(true); closeModal(); setTimeout(() => syncNotesWithDrive(), 100); } : closeModal}
                                            className="w-full flex items-center justify-center py-3 rounded-xl font-bold text-sm text-dark-bg/60 dark:text-light-bg/60 hover:bg-dark-bg/5 dark:hover:bg-white/5 transition-all"
                                        >
                                            {mode === 'setup' ? 'Skip Encryption' : 'Cancel Sync'}
                                        </button>
                                    </>
                                )}
                            </div>

                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
