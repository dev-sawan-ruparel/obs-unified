import rawSiteContent from "./site.json";
import { messaging } from "./messaging.generated";

export type QA = {
  q: string;
  a: string;
};

export type Feature = {
  capabilityId: string;
  title: string;
  body: string;
  icon: string;
};

export type CcrBenchmarkCase = {
  name: string;
  withoutCcr: string;
  withCcr: string;
  measure: string;
};

export type CcrBenchmarkMetric = {
  label: string;
  raw: string;
  ccr: string;
};

export type SiteContent = {
  hero: {
    eyebrow: string;
    titleLine: string;
    accent: string;
    leadHtml: string;
    lead: string;
    metaLabelHtml: string;
    metaLabel: string;
    metaLinkLabel: string;
    identityLabel: string;
    identityChain: string;
    identityBody: string;
    imageAlt: string;
    figcaptionTitle: string;
    figcaptionBody: string;
  };
  features: {
    eyebrow: string;
    title: string;
    lead: string;
    items: Feature[];
  };
  ccr: {
    eyebrow: string;
    title: string;
    lead: string;
    beforeTitle: string;
    beforeBody: string;
    afterTitle: string;
    afterBody: string;
    benchmarkTitle: string;
    benchmarkLead: string;
    benchmarkResultTitle: string;
    benchmarkResultLead: string;
    benchmarkMetrics: CcrBenchmarkMetric[];
    benchmarkCommand: string;
    benchmarkDocUrl: string;
    benchmarkDocLabel: string;
    benchmarkCases: CcrBenchmarkCase[];
  };
  architecture: {
    eyebrow: string;
    title: string;
    lead: string;
    connectedGraphBody: string;
    debuggingAgentsBody: string;
  };
  faq: QA[];
  seo: {
    siteUrl: string;
    docsUrl: string;
    githubUrl: string;
    title: string;
    description: string;
    ogImageAlt: string;
    ogCaption: string;
  };
  schema: {
    reviewBody: string;
    featureList: string[];
  };
};

const raw = rawSiteContent as unknown as SiteContent;

export const siteContent: SiteContent = {
  ...raw,
  hero: {
    ...raw.hero,
    identityChain: messaging.authored.positioning.proof.identityChain,
    lead: raw.hero.lead.replace(
      "Debug AI agents, and help AI agents debug software. ",
      `${messaging.authored.positioning.hero.subhead} `
    ),
    leadHtml: raw.hero.leadHtml.replace(
      "Debug AI agents, and help AI agents debug software.",
      messaging.authored.positioning.hero.subhead
    ),
  },
};

