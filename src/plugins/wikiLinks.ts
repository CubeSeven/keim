import { $nodeSchema, $inputRule, $remark } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/prose/inputrules';
import { visit } from 'unist-util-visit';
import type { Node, Parent } from 'unist';

// Remark plugin to parse [[Note Title]]
const remarkWikiLink = () => (tree: Node) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, 'text', (node: any, index: number | undefined, parent: Parent | undefined) => {
        if (typeof index !== 'number' || !parent) return;
        const regex = /\[\[([^\]]+)\]\]/g;
        const value = node.value as string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nodes: any[] = [];
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(value)) !== null) {
            const [fullMatch, title] = match;
            const matchIndex = match.index;

            if (matchIndex > lastIndex) {
                nodes.push({ type: 'text', value: value.slice(lastIndex, matchIndex) });
            }

            nodes.push({
                type: 'wikiLink',
                value: title,
                data: {
                    hName: 'span',
                    hProperties: {
                        'data-type': 'wiki-link',
                        'data-title': title,
                    },
                },
            });

            lastIndex = matchIndex + fullMatch.length;
        }

        if (lastIndex < value.length) {
            nodes.push({ type: 'text', value: value.slice(lastIndex) });
        }

        if (nodes.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (parent.children as any).splice(index, 1, ...nodes);
        }
    });
};

export const wikiLinkRemarkPlugin = $remark('wikiLinkRemark', () => remarkWikiLink);

export const wikiLinkNode = $nodeSchema('wiki_link', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    attrs: {
        title: { default: '' },
    },
    parseDOM: [{
        tag: 'span[data-type="wiki-link"]',
        getAttrs: (dom) => ({
            title: (dom as HTMLElement).dataset.title || '',
        }),
    }],
    toDOM: (node) => [
        'span',
        {
            'data-type': 'wiki-link',
            'data-title': node.attrs.title,
            'class': 'wiki-link',
        },
        node.attrs.title,
    ],
    parseMarkdown: {
        match: (node) => node.type === 'wikiLink',
        runner: (state, node, type) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            state.addNode(type, { title: (node as any).value });
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === 'wiki_link',
        runner: (state, node) => {
            state.addNode('text', undefined, `[[${node.attrs.title}]]`);
        },
    },
}));

export const wikiLinkInputRule = $inputRule(() => new InputRule(
    /\[\[([^\]]+)\]\]$/,
    (state, match, start, end) => {
        const title = match[1];
        const nodeType = state.schema.nodes.wiki_link;
        if (!nodeType) return null;

        return state.tr.replaceWith(start, end, nodeType.create({ title }));
    }
));
