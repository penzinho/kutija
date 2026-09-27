// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Production URL, used for canonical and OG URLs (crawlers need absolute og:image URLs).
  // SITE_URL overrides it (e.g. for a staging domain).
  site: process.env.SITE_URL || 'https://nasdom.top',
  output: 'static',
  // The CSS is small (~25 KB); inlining it removes render-blocking requests on first load.
  build: { inlineStylesheets: 'always' },
  integrations: [
    preact(),
    // /komponente is an internal component sheet (noindex); OG images aren't pages.
    sitemap({ filter: (page) => !/\/(komponente|og)\//.test(page) }),
  ],
});
