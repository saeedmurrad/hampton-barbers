# Hampton Barbers website

Demo site for Hampton Barbers, Hampton Vale, Peterborough. Built with Astro (static output).

- `npm run dev` to work locally
- `npm run deploy` to build and publish to GitHub Pages (gh-pages branch)
- Shop details, prices and themes are in `src/data/site.ts`
- Themes are CSS variables in `src/styles/global.css`; preview with `?theme=heritage|fresh|street|club`
- Live-domain build: `SITE_URL=https://hamptonbarbers.co.uk BASE_PATH=/ PUBLIC_DEMO=false npm run build`

Prices are from the shop's 2022 price list and need the owner's confirmation. Photos are the shop's own.

## Admin page and Firebase

- `/admin/` edits the price list. Edits are a draft in the browser until "Publish to the website" is pressed.
- The published list is one Firestore document, `site/menu`, in the Firebase project `hampton-barbers`. Every design reads it when the page loads.
- Sign-in is Firebase email and password, with no confirmation email. The first signed-in person to press Publish becomes the owner (Firestore document `site/owner`); after that only the owner, or user IDs the owner adds to its `admins` list, can publish. Rules are in `firestore.rules`.
  After changing them: `firebase deploy --only firestore --project hampton-barbers --account <your account>`.
- Firebase web settings go in `.env` (see `.env.example`). Without them the admin page still works but cannot publish.
