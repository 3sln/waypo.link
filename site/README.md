# Public Waypo.link documentation

This package builds the public, forest/paper/coral Waypo.link documentation independently of the private Waypo implementation. It does not import the identity SDK or require a private checkout.

```sh
cd site
npm ci
npm run build
npm run check
npm run preview
```

Open <http://127.0.0.1:9417/> or `/docs`. The loopback preview serves the public landing and documentation. The provider account application remains at `/login`; the offline account chooser remains at `/account-select`. The preview itself does not run authentication.

Edit the curated public Markdown in `../documentation/`. Design pages are provisional and implementation guides distinguish local evidence from production verification. Do not add private review ledgers, transcripts, snapshots, credentials or historical product specifications. New Markdown pages are discovered automatically. The builder rejects links to unpublished documents and disables raw Markdown HTML. `marked` is pinned in this package and needs no CDN or frontend framework.

Build outputs are `dist/` (static preview/export) and `../hosted/waypo/documentation-assets.mjs` (checked-in Worker-safe static map). `../hosted/waypo/documentation.mjs` exports `documentationResponse(request): Response | null`. Mount this handler before identity/bootstrap, cookies and billing, scoped to the exact configured issuer origin. A separate administration origin must fall through to the provider; pathname alone is insufficient. Configless Worker documentation is limited to canonical `https://waypo.link`. The loopback preview passes its own explicit public origin. It handles `/`, `/docs`, documentation assets, source Markdown, `/robots.txt` and `/sitemap.xml` without session access. Unknown documentation paths return 404; unrelated paths return null. Only GET and HEAD are accepted.

The builder removes its output directory before writing. `PUBLIC_DOCS_OUTPUT` can select an isolated static output directory. Do not point it at a directory containing other work.

Article metadata is authored from static public title/description values and canonical `https://waypo.link/docs` paths. Request queries, fragments, cookies and account data never enter document generation. The 1200×630 social image and icons are the hosted Waypo.link family copied from the approved brand kit; they do not confer authentication or administrative authority. Private API/auth routes remain outside the sitemap and robots allowlist. Search crawler instructions are not access control.

Browser evidence is deliberately opt-in and stored outside the repository, not checked into public source. Static link/build checks and actual desktop/mobile Playwright probes cover rendered Markdown, assets, metadata, horizontal overflow and console errors. No cloud writes or deployments are part of this package.
