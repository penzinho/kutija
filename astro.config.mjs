// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  // Production URL, used for canonical and OG URLs. Set SITE_URL in Vercel.
  site: process.env.SITE_URL,
  output: 'static',
  // The CSS is small (~25 KB); inlining it removes render-blocking requests on first load.
  build: { inlineStylesheets: 'always' },
  integrations: [preact()],
});
