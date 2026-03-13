import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import remarkDirective from 'remark-directive';

export const remarkDirectivePlugin = $remark('remarkDirective', () => remarkDirective);

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
