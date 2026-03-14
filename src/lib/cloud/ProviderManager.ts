import type { CloudProvider } from './CloudProvider';

// Default to DropboxProvider initially.
// We lazily import it to avoid circular dependencies if we need them, 
// though right now simple import is fine.
import { DropboxProvider } from './DropboxProvider';

let activeProvider: CloudProvider = new DropboxProvider();

export function setCloudProvider(provider: CloudProvider) {
    activeProvider = provider;
}

export function getCloudProvider(): CloudProvider {
    return activeProvider;
}
