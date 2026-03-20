import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import { visit } from 'unist-util-visit';
import type { Node, Parent } from 'unist';

export interface AppLinkInfo {
    platform: 'YouTube' | 'Twitter' | 'GitHub' | 'GoogleDocs' | 'GoogleMaps' | 'Vimeo' | 'Twitch' | 'SoundCloud' | 'Spotify' | 'Instagram' | 'TikTok' | 'CodePen' | 'Unknown';
    url: string;
    isEmbeddable: boolean;
}

export function parseAppUrl(url: string): AppLinkInfo {
    if (/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/.test(url)) {
        return { platform: 'YouTube', url, isEmbeddable: true };
    }
    if (/^(https?:\/\/)?(www\.)?(twitter\.com|x\.com)\/.+$/.test(url)) {
        return { platform: 'Twitter', url, isEmbeddable: true };
    }
    if (/^(https?:\/\/)?(www\.)?(vimeo\.com)\/\d+/.test(url)) {
        return { platform: 'Vimeo', url, isEmbeddable: true };
    }
    if (/^(https?:\/\/)?(www\.)?(twitch\.tv)\/.+$/.test(url)) {
        return { platform: 'Twitch', url, isEmbeddable: true };
    }
    if (/^(https?:\/\/)?(soundcloud\.com)\/.+$/.test(url)) {
        return { platform: 'SoundCloud', url, isEmbeddable: true };
    }
    if (/^(https?:\/\/)?(open\.spotify\.com)\/.+$/.test(url)) {
        return { platform: 'Spotify', url, isEmbeddable: true };
    }
    if (/^(https?:\/\/)?(www\.)?(instagram\.com|threads\.net)\/.+$/.test(url)) {
        return { platform: 'Instagram', url, isEmbeddable: true };
    }
    if (/^(https?:\/\/)?(www\.)?(tiktok\.com)\/.+$/.test(url)) {
        return { platform: 'TikTok', url, isEmbeddable: true };
    }
    if (/^(https?:\/\/)?(codepen\.io)\/.+$/.test(url)) {
        return { platform: 'CodePen', url, isEmbeddable: true };
    }
    if (/^(https?:\/\/)?(github\.com)\/.+$/.test(url)) {
        return { platform: 'GitHub', url, isEmbeddable: false };
    }
    if (/^(https?:\/\/)?(docs\.google\.com)\/(document|spreadsheets|presentation)\/.+$/.test(url)) {
        return { platform: 'GoogleDocs', url, isEmbeddable: false };
    }
    if (/^(https?:\/\/)?(www\.)?(google\.com\/maps|maps\.app\.goo\.gl)\/.+$/.test(url)) {
        return { platform: 'GoogleMaps', url, isEmbeddable: false };
    }
    return { platform: 'Unknown', url, isEmbeddable: false };
}

// 1. Remark Plugin to find links and convert them to our custom node if they match
const remarkAppLinks = () => (tree: Node) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, 'link', (node: any, index: number | undefined, parent: Parent | undefined) => {
        if (typeof index !== 'number' || !parent) return;
        
        const url = node.url as string;
        const info = parseAppUrl(url);
        
        if (info.platform !== 'Unknown') {
            const newNode = {
                type: 'appLink',
                url: info.url,
                platform: info.platform,
                title: node.title || (node.children[0]?.value) || url,
                data: {
                    hName: 'span',
                    hProperties: {
                        'data-type': 'app-link',
                        'data-url': info.url,
                        'data-platform': info.platform,
                        'data-title': node.title || (node.children[0]?.value) || url,
                    },
                },
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (parent.children as any).splice(index, 1, newNode);
        }
    });
};

export const appLinkRemarkPlugin = $remark('appLinkRemark', () => remarkAppLinks);

// 2. Prosemirror Node Schema
export const appLinkNode = $nodeSchema('app_link', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    attrs: {
        url: { default: '' },
        platform: { default: '' },
        title: { default: '' }
    },
    parseDOM: [{
        tag: 'span[data-type="app-link"]',
        getAttrs: (dom) => ({
            url: (dom as HTMLElement).dataset.url || '',
            platform: (dom as HTMLElement).dataset.platform || '',
            title: (dom as HTMLElement).dataset.title || '',
        }),
    }],
    toDOM: (node) => [
        'span',
        {
            'data-type': 'app-link',
            'data-url': node.attrs.url,
            'data-platform': node.attrs.platform,
            'data-title': node.attrs.title,
            'class': 'app-link-chip',
        },
        node.attrs.title,
    ],
    parseMarkdown: {
        match: (node) => node.type === 'appLink',
        runner: (state, node, type) => {
            state.addNode(type, { 
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                url: (node as any).url, 
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                platform: (node as any).platform,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                title: (node as any).title
            });
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === 'app_link',
        runner: (state, node) => {
            // Convert back to standard markdown link so it's portable
            state.addNode('link', undefined, undefined, {
                url: node.attrs.url,
                title: node.attrs.title,
                children: [{ type: 'text', value: node.attrs.title }]
            });
        },
    },
}));