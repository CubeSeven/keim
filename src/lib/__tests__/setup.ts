/// <reference types="node" />
import { webcrypto } from 'node:crypto';

// Polyfill Web Crypto API for jsdom since jsdom doesn't provide it by default
if (!globalThis.crypto) {
    // @ts-expect-error - webcrypto missing from node types
    globalThis.crypto = webcrypto;
}

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
    cleanup();
});
