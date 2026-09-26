// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  // Production URL, used for canonical and OG URLs (crawlers need absolute og:image URLs).
  // Set SITE_URL in Vercel; the Vercel production domain is the fallback.
  site:
    process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined),
  output: 'static',
  // The CSS is small (~25 KB); inlining it removes render-blocking requests on first load.
  build: { inlineStylesheets: 'always' },
  integrations: [preact()],
});
