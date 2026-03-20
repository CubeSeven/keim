import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import remarkDirective from 'remark-directive';
import { visit } from 'unist-util-visit';

export const remarkDirectivePlugin = $remark('remarkDirective', () => remarkDirective);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const remarkFallbackDirectives = () => (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, (node: any) => {
        if (['textDirective', 'leafDirective', 'containerDirective'].includes(node.type)) {
            if (node.name !== 'dashboard') {
                const prefix = node.type === 'textDirective' ? ':' : node.type === 'leafDirective' ? '::' : ':::';
                node.type = 'text';
                node.value = `${prefix}${node.name}`;
            }
        }
    });
};

export const remarkDirectiveFallbackPlugin = $remark('remarkFallbackDirectives', () => remarkFallbackDirectives);

export const dashboardNode = $nodeSchema('dashboard', () => ({
    group: 'block',
    atom: true,
    isolating: true,
    marks: '',
    attrs: {
        folder: { default: '' }
    },
    parseDOM: [{ 
        tag: 'div[data-type="dashboard"]',
        getAttrs: (dom) => ({ folder: (dom as HTMLElement).dataset.folder || '' })
    }],
    toDOM: (node) => ['div', { 'data-type': 'dashboard', 'data-folder': node.attrs.folder }],
    parseMarkdown: {
        match: (node) => node.type === 'containerDirective' && node.name === 'dashboard',
        runner: (state, node, type) => {
            state.addNode(type, { folder: (node.attributes as { folder?: string })?.folder || '' });
        }
    },
    toMarkdown: {
        match: (node) => node.type.name === 'dashboard',
        runner: (state, node) => {
            state.addNode('containerDirective', undefined, undefined, {
                name: 'dashboard',
                attributes: { folder: node.attrs.folder }
            });
        }
    }
}));
