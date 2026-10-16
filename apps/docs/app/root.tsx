import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';
import { RootProvider } from 'fumadocs-ui/provider/react-router';
import type { Route } from './+types/root';
import './app.css';
import SearchDialog from '@/components/search';
import NotFound from './routes/not-found';

export const links: Route.LinksFunction = () => [
  // Brand assets — synced from @obsunified/brand. Re-run
  // `node packages/brand/scripts/sync-to-projects.mjs` after edits.
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
  { rel: 'alternate icon', href: '/favicon.ico' },
  { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/site.webmanifest' },
  {
    rel: 'sitemap',
    type: 'application/xml',
    title: 'Sitemap',
    href: 'https://docs.obsunified.com/sitemap.xml',
  },
  {
    rel: 'alternate',
    type: 'text/plain',
    href: 'https://docs.obsunified.com/llms.txt',
    title: 'LLMs.txt — Machine-readable documentation index for AI agents',
  },
  {
    rel: 'alternate',
    type: 'text/plain',
    href: 'https://docs.obsunified.com/llms-full.txt',
    title: 'LLMs-full.txt — Complete documentation corpus in Markdown',
  },
  {
    rel: 'alternate',
    type: 'text/plain',
    href: 'https://obsunified.com/llms.txt',
    title: 'Observability Unified Primary AI Agent Guide',
  },

  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap',
  },
];

export const meta: Route.MetaFunction = () => [
  { title: 'obs-unified docs — unified observability' },
  {
    name: 'description',
    content:
      'Built for agentic debugging: one telemetry graph agents can traverse from user action to backend trace, logs, replay, AI cost, MCP tool context, and CPU profile.',
  },
  {
    name: 'robots',
    content:
      'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
  },
  { property: 'og:type', content: 'website' },
  { property: 'og:locale', content: 'en_US' },
  { property: 'og:site_name', content: 'obs-unified docs' },
  {
    property: 'og:title',
    content: 'obs-unified docs — unified observability',
  },
  {
    property: 'og:description',
    content:
      'Built for agentic debugging: one telemetry graph agents can traverse from user action to backend trace, logs, replay, AI cost, MCP tool context, and CPU profile.',
  },
  { property: 'og:url', content: 'https://docs.obsunified.com/' },
  { property: 'og:image', content: 'https://docs.obsunified.com/og.jpg' },
  {
    property: 'og:image:secure_url',
    content: 'https://docs.obsunified.com/og.jpg',
  },
  { property: 'og:image:type', content: 'image/jpeg' },
  { property: 'og:image:width', content: '1200' },
  { property: 'og:image:height', content: '630' },
  {
    property: 'og:image:alt',
    content:
      'obs-unified documentation — telemetry graph, SDKs, MCP server, and self-hosting reference',
  },
  { name: 'twitter:card', content: 'summary_large_image' },
  {
    name: 'twitter:title',
    content: 'obs-unified docs — unified observability',
  },
  {
    name: 'twitter:description',
    content:
      'Built for agentic debugging with Agent Action Graphs and MCP tools agents can traverse end-to-end.',
  },
  { name: 'twitter:image', content: 'https://docs.obsunified.com/og.jpg' },
  {
    name: 'twitter:image:alt',
    content:
      'obs-unified documentation — telemetry graph, SDKs, MCP server, and self-hosting reference',
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#006B18" />
        <Meta />
        <Links />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider search={{ SearchDialog }}>{children}</RootProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Oops!';
  let details = 'An unexpected error occurred.';
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) return <NotFound />;
    message = 'Error';
    details = error.statusText;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 w-full max-w-[1400px] mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
