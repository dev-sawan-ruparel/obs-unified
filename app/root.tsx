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
  // Brand assets — synced from @obs-unified/brand. Re-run
  // `node packages/brand/scripts/sync-to-projects.mjs` after edits.
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
  { rel: 'alternate icon', href: '/favicon.ico' },
  { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/site.webmanifest' },

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

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#006B18" />

        {/* Site-wide social defaults. Per-route Meta below can override
            og:title / og:description; the og:image stays constant. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="obs-unified" />
        <meta
          property="og:title"
          content="obs-unified docs — unified observability"
        />
        <meta
          property="og:description"
          content="One collector, one identity chain, and one dashboard for traces, logs, AI calls, replay, usage, alerts, profiles, and analyses."
        />
        <meta property="og:url" content="https://docs.obsunified.com/" />
        <meta
          property="og:image"
          content="https://docs.obsunified.com/og.jpg"
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="obs-unified docs — unified observability"
        />
        <meta
          name="twitter:description"
          content="One collector, one identity chain, and one dashboard for every signal."
        />
        <meta
          name="twitter:image"
          content="https://docs.obsunified.com/og.jpg"
        />
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
