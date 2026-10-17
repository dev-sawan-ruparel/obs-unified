import type { Route } from './+types/docs';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { getPageImageUrl, getPageMarkdownUrl, source } from '@/lib/source';
import browserCollections from 'collections/browser';
import { baseOptions } from '@/lib/layout.shared';
import { GITHUB_REPO_LINK, gitBranch } from '@/lib/shared';
import { useFumadocsLoader } from 'fumadocs-core/source/client';
import { useMDXComponents } from '@/components/mdx';

const DOCS_ORIGIN = 'https://docs.obsunified.com';

export async function loader({ params }: Route.LoaderArgs) {
  const slugs = params['*'].split('/').filter((v) => v.length > 0);
  const page = source.getPage(slugs);
  if (!page) throw new Response('Not found', { status: 404 });

  return {
    path: page.path,
    url: page.url,
    slugs: page.slugs,
    title: page.data.title,
    description: page.data.description ?? '',
    ogImageUrl: getPageImageUrl(page),
    markdownUrl: getPageMarkdownUrl(page).url,
    pageTree: await source.serializePageTree(source.getPageTree()),
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) {
    return [{ title: 'Not Found — obs-unified docs' }];
  }

  const pageTitle = `${data.title} — obs-unified docs`;
  // Cloudflare Pages 308-redirects /docs/x to /docs/x/, so canonical URLs
  // must carry the trailing slash to avoid pointing at a redirect.
  const canonicalUrl = `${DOCS_ORIGIN}${data.url.replace(/\/$/, '')}/`;
  const ogImageUrl = `${DOCS_ORIGIN}${data.ogImageUrl}`;
  const markdownUrl = `${DOCS_ORIGIN}${data.markdownUrl}`;
  const imageAlt = data.description
    ? `${data.title} — ${data.description}`
    : pageTitle;

  const breadcrumbItems = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'obs-unified docs',
      item: `${DOCS_ORIGIN}/docs/`,
    },
    ...(data.url !== '/docs'
      ? [
          {
            '@type': 'ListItem',
            position: 2,
            name: data.title,
            item: canonicalUrl,
          },
        ]
      : []),
  ];

  return [
    { title: pageTitle },
    { name: 'description', content: data.description },
    {
      name: 'robots',
      content:
        'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
    },
    { tagName: 'link', rel: 'canonical', href: canonicalUrl },
    {
      tagName: 'link',
      rel: 'alternate',
      type: 'text/markdown',
      href: markdownUrl,
      title: `${data.title} — Raw Markdown for AI Agents`,
    },
    { property: 'og:type', content: 'article' },
    { property: 'og:locale', content: 'en_US' },
    { property: 'og:site_name', content: 'obs-unified docs' },
    { property: 'og:title', content: pageTitle },
    { property: 'og:description', content: data.description },
    { property: 'og:url', content: canonicalUrl },
    { property: 'og:image', content: ogImageUrl },
    { property: 'og:image:secure_url', content: ogImageUrl },
    { property: 'og:image:type', content: 'image/jpeg' },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: imageAlt },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: data.description },
    { name: 'twitter:image', content: ogImageUrl },
    { name: 'twitter:image:alt', content: imageAlt },
    {
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'TechArticle',
            '@id': `${canonicalUrl}#article`,
            headline: data.title,
            name: pageTitle,
            description: data.description,
            url: canonicalUrl,
            image: ogImageUrl,
            inLanguage: 'en-US',
            author: {
              '@type': 'Organization',
              name: 'Observability Unified',
              url: 'https://obsunified.com/',
            },
            publisher: {
              '@type': 'Organization',
              name: 'Observability Unified',
              url: 'https://obsunified.com/',
              logo: {
                '@type': 'ImageObject',
                url: `${DOCS_ORIGIN}/icon-512.png`,
              },
            },
            isPartOf: {
              '@type': 'WebSite',
              '@id': `${DOCS_ORIGIN}/#website`,
              name: 'obs-unified documentation',
              url: `${DOCS_ORIGIN}/`,
            },
            about: {
              '@type': 'SoftwareApplication',
              name: 'Observability Unified',
              url: 'https://obsunified.com/',
            },
            subjectOf: {
              '@type': 'TextDigitalDocument',
              name: `${data.title} (Markdown for AI Agents)`,
              url: markdownUrl,
              encodingFormat: 'text/markdown',
            },
          },
          {
            '@type': 'BreadcrumbList',
            '@id': `${canonicalUrl}#breadcrumbs`,
            itemListElement: breadcrumbItems,
          },
        ],
      },
    },
  ];
}

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: Mdx },
    // you can define props for the component
    {
      markdownUrl,
      path,
    }: {
      markdownUrl: string;
      path: string;
    },
  ) {
    return (
      <DocsPage toc={toc}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`${GITHUB_REPO_LINK}/blob/${gitBranch}/apps/docs/content/docs/${path}`}
          />
        </div>
        <DocsBody>
          <Mdx components={useMDXComponents()} />
        </DocsBody>
      </DocsPage>
    );
  },
});

export default function Page({ loaderData }: Route.ComponentProps) {
  const { pageTree, path, markdownUrl } = useFumadocsLoader(loaderData);

  return (
    <DocsLayout {...baseOptions()} tree={pageTree}>
      {clientLoader.useContent(loaderData.path, {
        markdownUrl,
        path,
      })}
    </DocsLayout>
  );
}
