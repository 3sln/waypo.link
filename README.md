# Waypo.link

The branded hosted deployment of [Waypo](https://github.com/3sln/waypo), with public protocol, integration and self-hosting documentation. The initial service profile is free; legacy Polar billing support remains deferred. The portable open-source provider lives in the adjacent `../waypo` project; it works without this deployment or Polar.

- `hosted/waypo/`: Node and Cloudflare Workers composition, branding and billing.
- `documentation/`: public documentation source served under `/docs`.
- `site/`: independent documentation build, checks and preview.
- `scripts/build-docs.mjs`: generates the Worker-safe documentation assets.

The web issuer is `https://waypo.link/api/auth`. `login.waypo.link`, `account.waypo.link` and `notify.waypo.link` are email-sending domains, not separate identity origins.

Install the isolated packages with `npm --prefix site ci` and `npm --prefix hosted/waypo ci` after preparing the adjacent Waypo checkout at the reviewed commit in `hosted/waypo/waypo-ref.txt`. Run `npm run build:docs`, `npm run check:docs`, `npm test`, and the opt-in prerelease `npm run test:e2e`. The documentation package can build without access to the private provider repository.

Production release remains disabled. Passing local tests or configuring bindings does not establish production delivery, billing or interoperability. Current implementation and evidence limits remain in `DEVLOG.md` and the public readiness documentation.

The retired Bindle application graph has been removed from the active project. Its uncommitted files and notes were preserved in a private local migration archive; repository history remains intact.

Paired local qualification: this tree pins Waypo to `21ecbc35efc56ae9ac86e04062b70d85a6c313dc` (reviewed runtime source `c34f0e7`, followed by a ledger-only qualification commit). Core engine1307/1307, hosted engine65/65, full hosted Node/Worker prerelease12/12, public documentation checks and local Wrangler dry-run passed. The hosted disposable-email policy leaves existing sign-in and default self-host admission unchanged. Production/public operation remains disabled; these checks do not establish live email delivery.

Current isolated token-work candidate selects `8c62e73f1859756a9217d52a3a8dffacddaa5ebe`. Optional app token work shares the installation ordinary period ceiling, with owner-exit reserve preserved; identity-only hosted configurations require explicit finite work policies and protected activation. Component tests are recorded separately; full paired qualification remains pending. Production/public operation remains disabled.

The hosted package pins `e178a12aeec742c9ba38545da0a5059c767d7d37`, preserving reviewed identity, signup and cost controls while adding independent app-private blob storage. The functional core passed1356 engine tests; maintained Node and actual sharded Worker browser paths are locally qualified, with the final Worker also checking the browser SDK and restart fixture. Hosted selected policy tests14/14, published documentation46 pages and Worker dry bundle pass. Production/public operation remains disabled. Files currently use a4MiB bounded transport; larger streaming files remain a required prerelease task.
