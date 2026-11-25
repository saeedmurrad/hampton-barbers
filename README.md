# Hampton Barbers website

Demo site for Hampton Barbers, Hampton Vale, Peterborough. Built with Astro (static output).

- `npm run dev` to work locally
- `npm run deploy` to build and publish to GitHub Pages (gh-pages branch)
- Shop details, prices and themes are in `src/data/site.ts`
- Themes are CSS variables in `src/styles/global.css`; preview with `?theme=heritage|fresh|street|club`
- Live-domain build: `SITE_URL=https://hamptonbarbers.co.uk BASE_PATH=/ PUBLIC_DEMO=false npm run build`

Prices are from the shop's 2022 price list and need the owner's confirmation. Photos are the shop's own.
