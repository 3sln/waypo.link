// HTTP route registry (docs/architecture/app-engine.md §7, §12).
//
// packages/runtime/http.mjs is a small router: it runs these stages in order and keeps the cross-cutting steps
// between them (origin and method checks, CSRF, the session, owner resolution, capacity admission, activity).
//   edge             before the app-origin check (the dedicated embed origin)
//   public           credentialless and capability routes, before the method allowlist
//   anonymous        after the method allowlist, before the CSRF check
//   unauthenticated  after the CSRF check, before the /api/ session block
//   api              first step of the /api/ block, before session cookies are read
//   session          with the identity engine and request context; before owner resolution
//   beforeActivity   owner routes that run before capacity admission and activity are recorded
//   owner            owner routes after admission and `touch`
//   pages            everything outside /api/ (the site module always answers)
// A stage handler receives the request context ({request, env, execution, url, path, local, mutation}, later
// also {engine, context, vault, accountMember, ...} and {owner, id, object, dispatch}) and returns a Response,
// `passthrough(promise)` (returned outside the router's error funnel) or nothing, to let the next handler try.
//
// A route module may export `stages`, `allowedMethods(path)` (the 405 allowlist; null when it does not know the
// path) and `admission` ({protective: [{match(path, method), test(change)}], exempt(path)}): capacity admission
// is skipped for exempt paths and for protective changes, whose JSON body is read only when a rule matches.
//
// Routes of different modules in one stage must not overlap. Where they do, this order decides: `relations` (ORG-10f) answers only entity
// certificates on /oauth/token and the BindleEntity and relation-token schemes on /bindle/rpc before `memberCertificates`
// and `federation`, `memberCertificates` (ORG-4) answers only
// the jwt-bearer member grant on /oauth/token before `federation` and member holder-key status before `delegation`. `moved` (PORT-3) is first on purpose: its edge-stage router
// answers per-identity paths of a moved identity (308 during the redirect period) before any per-identity route,
// and falls through for every other identity. Append-only otherwise: one import and one entry per slice; a slice
// adds routes to its own module.
import * as transferIn from './transfer-in.mjs';
import * as intents from './intents.mjs';
import * as moved from './moved.mjs';
import * as transferPages from './transfer-pages.mjs';
import * as directory from './directory.mjs';
import * as site from './site.mjs';
import * as admin from './admin.mjs';
import * as identity from './identity.mjs';
import * as lifecycle from './lifecycle.mjs';
import * as deletion from './deletion.mjs';
import * as automation from './automation.mjs';
import * as profile from './profile.mjs';
import * as developerContact from './developer-contact.mjs';
import * as messages from './messages.mjs';
import * as views from './views.mjs';
import * as storage from './storage.mjs';
import * as billing from './billing.mjs';
import * as search from './search.mjs';
import * as notifications from './notifications.mjs';
import * as federation from './federation.mjs';
import * as delegation from './delegation.mjs';
import * as incremental from './incremental.mjs';
import * as events from './events.mjs';
import * as appSessions from './app-sessions.mjs';
import * as integrations from './integrations.mjs';
import * as connections from './connections.mjs';
import * as emailBridge from './email-bridge.mjs';
import * as exports from './exports.mjs';
import * as retention from './retention.mjs';
import * as appRemoval from './app-removal.mjs';
import * as orgs from './orgs.mjs';
import * as memberCertificates from './member-certificates.mjs';
import * as recoveryReissue from './recovery-reissue.mjs';
import * as orgClaimAbort from './org-claim-abort.mjs';
import * as relations from './relations.mjs';
import * as signalingOwner from './signaling-owner.mjs';
import * as signaling from './signaling.mjs';

export const ROUTES=Object.freeze([moved,transferPages,directory,intents,recoveryReissue,orgClaimAbort,site,admin,identity,lifecycle,deletion,automation,profile,developerContact,messages,views,storage,billing,search,notifications,relations,memberCertificates,federation,delegation,incremental,events,appSessions,integrations,connections,emailBridge,exports,retention,appRemoval,orgs,transferIn,signalingOwner,signaling]);
export const STAGES=Object.freeze(['edge','public','anonymous','unauthenticated','api','session','beforeActivity','owner','pages']);
for(const module of ROUTES)for(const name of Object.keys(module.stages??{}))if(!STAGES.includes(name))throw new TypeError(`Unknown route stage ${name}`);

/** The first answer of a stage's handlers, in registry order, or null. */
export async function stage(name,context){for(const module of ROUTES){const handler=module.stages?.[name];if(handler){const response=await handler(context);if(response)return response;}}return null;}
/** The methods a known path allows, or null. */
export function routeMethods(path){for(const module of ROUTES){const allow=module.allowedMethods?.(path);if(allow)return allow;}return null;}
export const admission=Object.freeze({protective:Object.freeze(ROUTES.flatMap(module=>module.admission?.protective??[])),exempt:path=>ROUTES.some(module=>module.admission?.exempt?.(path))});
