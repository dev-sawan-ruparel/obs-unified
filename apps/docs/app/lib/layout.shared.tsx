import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, GITHUB_REPO_LINK } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // JSX supported
      title: appName,
    },
    githubUrl: GITHUB_REPO_LINK,
  };
}
