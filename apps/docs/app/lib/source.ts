import { loader } from 'fumadocs-core/source';
import { docs } from 'collections/server';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
});

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];

  return {
    segments,
    url: `${docsContentRoute}/${segments.join('/')}`,
  };
}

export function getPageImageUrl(page: (typeof source)['$inferPage']) {
  const slugPath = page.slugs.length > 0 ? page.slugs.join('/') : 'index';
  return `${docsImageRoute}/${slugPath}.jpg`;
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
