import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { isValidElement } from 'react';
import { Mermaid } from './mermaid';

function extractText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }

  if (isValidElement(node)) {
    return extractText((node.props as { children?: unknown }).children);
  }

  return '';
}

function isMermaidChart(text: string) {
  return /^(flowchart|graph|timeline|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|journey|pie|mindmap|quadrantChart|sankey-beta)\b/.test(
    text.trim(),
  );
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    pre: (props) => {
      const text = extractText(props.children);

      if (isMermaidChart(text)) {
        return <Mermaid chart={text.trim()} />;
      }

      return defaultMdxComponents.pre(props);
    },
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
