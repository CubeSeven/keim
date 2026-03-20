import { $nodeSchema, $inputRule, $remark } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/prose/inputrules';
import * as chrono from 'chrono-node';
import { visit } from 'unist-util-visit';
import type { Node, Parent } from 'unist';

// Remark plugin to detect dates in markdown
const remarkTemporal = () => (tree: Node) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, 'text', (node: any, index: number | undefined, parent: Parent | undefined) => {
        if (typeof index !== 'number' || !parent) return;
        const value = node.value as string;
        const results = chrono.parse(value);
        if (results.length === 0) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nodes: any[] = [];
        let lastIndex = 0;

        results.forEach((result) => {
            const matchIndex = result.index;
            const text = result.text;

            if (matchIndex > lastIndex) {
                nodes.push({ type: 'text', value: value.slice(lastIndex, matchIndex) });
            }

            nodes.push({
                type: 'temporal',
                value: text,
                date: result.start.date().toISOString(),
                data: {
                    hName: 'span',
                    hProperties: {
                        'data-type': 'temporal-chip',
                        'data-value': text,
                        'data-date': result.start.date().toISOString(),
                    },
                },
            });

            lastIndex = matchIndex + text.length;
        });

        if (lastIndex < value.length) {
            nodes.push({ type: 'text', value: value.slice(lastIndex) });
        }

        if (nodes.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (parent.children as any).splice(index, 1, ...nodes);
        }
    });
};

export const temporalRemarkPlugin = $remark('temporalRemark', () => remarkTemporal);

export const temporalChipNode = $nodeSchema('temporal_chip', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    attrs: {
        value: { default: '' },
        date: { default: '' },
    },
    parseDOM: [{
        tag: 'span[data-type="temporal-chip"]',
        getAttrs: (dom) => ({
            value: (dom as HTMLElement).dataset.value || '',
            date: (dom as HTMLElement).dataset.date || '',
        }),
    }],
    toDOM: (node) => [
        'span',
        {
            'data-type': 'temporal-chip',
            'data-value': node.attrs.value,
            'data-date': node.attrs.date,
            'class': 'temporal-chip',
            'title': new Date(node.attrs.date).toLocaleString(),
        },
        node.attrs.value,
    ],
    parseMarkdown: {
        match: (node) => node.type === 'temporal',
        runner: (state, node, type) => {
            state.addNode(type, { 
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                value: (node as any).value, 
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                date: (node as any).date 
            });
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === 'temporal_chip',
        runner: (state, node) => {
            state.addNode('text', undefined, node.attrs.value);
        },
    },
}));

// Input rule to convert text to temporal chip when followed by a space
export const temporalInputRule = $inputRule(() => new InputRule(
    /(?:^|\s)([\w\s,/-]{2,40})\s$/,
    (state, match, start, end) => {
        const fullMatch = match[0];
        const textWithPotentialLeadingSpace = match[1];
        const text = textWithPotentialLeadingSpace.trim();
        
        console.log('[Temporal] Potential date found:', text);
        
        const results = chrono.parse(text);
        
        // We want to match if chrono found a date that EXACTLY matches the typed text
        if (results.length > 0) {
            const result = results[0];
            // Check if the parsed text matches the end of our captured text
            // This allows sentences like "See you next friday " where we only want to convert "next friday"
            if (text.toLowerCase().endsWith(result.text.toLowerCase())) {
                const nodeType = state.schema.nodes.temporal_chip;
                if (!nodeType) return null;

                // Calculate the actual start position for the chip
                // 'start' is the beginning of the regex match (including potential leading space)
                // We want to replace only the part that chrono matched
                const matchOffset = textWithPotentialLeadingSpace.toLowerCase().lastIndexOf(result.text.toLowerCase());
                const prefixOffset = fullMatch.indexOf(textWithPotentialLeadingSpace);
                const actualStart = start + prefixOffset + matchOffset;
                
                console.log('[Temporal] Converting to chip:', result.text, 'at pos:', actualStart);

                return state.tr.replaceWith(
                    actualStart, 
                    end, 
                    nodeType.create({ 
                        value: result.text, 
                        date: result.start.date().toISOString() 
                    })
                );
            }
        }
        return null;
    }
));
