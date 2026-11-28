// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Demo build: https://saeedmurrad.github.io/hampton-barbers/
// Live build: SITE_URL=https://hamptonbarbers.co.uk BASE_PATH=/ PUBLIC_DEMO=false npm run build
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://saeedmurrad.github.io',
  base: process.env.BASE_PATH ?? '/hampton-barbers',
  trailingSlash: 'always',
  // Staff screens (queue desk, barber panel, shop TV, door poster) stay out of the sitemap.
  integrations: [sitemap({ filter: (page) => !/\/(admin|barber|board|poster)\//.test(page) })],
});
