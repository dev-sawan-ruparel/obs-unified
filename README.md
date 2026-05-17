# presence

Marketing / landing page for [obs-unified](https://github.com/sawanruparel/obs-unified).

Vanilla TypeScript + Vite. No framework. Optimized for AEO (answer-engine
optimization): JSON-LD `SoftwareApplication` and `FAQPage` schemas, semantic
HTML5 landmarks, `llms.txt`, sitemap, and explicit AI-crawler allowlist.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:4173
pnpm build      # static output in dist/
pnpm preview    # serve dist/
```

## Structure

```
presence/
├── index.html               # head: meta, OG, Twitter, JSON-LD
├── src/
│   ├── main.ts              # composes the page
│   ├── style.css            # dark theme, no framework
│   └── sections/
│       ├── header.ts
│       ├── hero.ts
│       ├── features.ts
│       ├── preview.ts
│       ├── architecture.ts
│       ├── faq.ts
│       └── footer.ts
└── public/
    ├── favicon.svg
    ├── robots.txt           # explicit AI-crawler allow
    ├── sitemap.xml
    └── llms.txt             # llms.txt spec for AI search
```

## AEO checklist

- JSON-LD: `SoftwareApplication`, `Organization`, `WebSite`, `FAQPage`
- `llms.txt` summarizing the project in long-form, answer-ready prose
- Semantic landmarks: `header`, `main`, `section[aria-labelledby]`, `footer`
- Direct factual lead sentences ("obs-unified is…") for snippet extraction
- Open Graph + Twitter cards, canonical URL
- Sitemap + robots with named AI crawlers (GPTBot, ClaudeBot, PerplexityBot…)
