# Waypo.link

The branded hosted deployment of [Waypo](https://github.com/3sln/waypo), with Polar billing and public protocol, integration and self-hosting documentation. The portable open-source provider lives in the adjacent `../waypo` project; it works without this deployment or Polar.

- `hosted/waypo/`: Node and Cloudflare Workers composition, branding and billing.
- `documentation/`: public documentation source served under `/docs`.
- `site/`: independent documentation build, checks and preview.
- `scripts/build-docs.mjs`: generates the Worker-safe documentation assets.

The web issuer is `https://waypo.link/api/auth`. `login.waypo.link`, `account.waypo.link` and `notify.waypo.link` are email-sending domains, not separate identity origins.

Install the isolated packages with `npm --prefix site ci` and `npm --prefix hosted/waypo ci` after preparing the adjacent Waypo checkout at the reviewed commit in `hosted/waypo/waypo-ref.txt`. Run `npm run build:docs`, `npm run check:docs`, `npm test`, and the opt-in prerelease `npm run test:e2e`. The documentation package can build without access to the private provider repository.

Production release remains disabled. Passing local tests or configuring bindings does not establish production delivery, billing or interoperability. Current implementation and evidence limits remain in `DEVLOG.md` and the public readiness documentation.

The retired Bindle application graph has been removed from the active project. Its uncommitted files and notes were preserved in a private local migration archive; repository history remains intact.

Candidate reconciliation: this isolated tree pins Waypo to `2c842d48683beaa1879f41eefb58dd32d485c154`. The core child passed clean CI and was merged in `ed854b3`. Local hosted primary31 and runtime6 checks passed against this exact pin; the final private paired CI remains a pre-merge gate. This is not a production release claim.
