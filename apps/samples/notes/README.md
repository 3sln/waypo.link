# Notes (sample app)

A small local-first notes app that shows the Bindle "works signed out, sign in to sync" pattern: notes live on the
device; `<bindle-sign-in>` (the provider's sign-in island where the provider offers one, otherwise "Use a different
provider" and a top-level redirect) adds a synced copy in `object-storage/v1` storage the person chooses at consent,
merging the notes written before sign-in. It also shows a `preferences` value (sort order), incremental authorization
(reminders ask for the app-messages fragment only when turned on), app messages, `<bindle-account>` with the provider's
account switcher, and clean removal (`/bindle/remove`, app-removal §6). It registers through its client-id metadata
document at `https://notes.example/bindle/client.json` (a public client), uses only `.example` hosts, and is sample code
(MIT, unpublished). It runs inside the multi-provider simulation (`npm run sim:small`, `npm run sim:shots`).
