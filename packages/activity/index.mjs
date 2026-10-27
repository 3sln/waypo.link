// Core app-originated activity (docs/spec/activity.md; host design docs/architecture/activity-center.md).
// Engine operations live in packages/app/domains/activity.mjs; everything exposed is behind ACTIVITY_V2_ENABLED.
export {ACTIVITY_LIMITS,ACTIVITY_PURPOSE,PRIORITIES,ActivityFault,activityInput,appTagId,qualifiedTag,principalOf} from './model.mjs';
export {admissionEvidence,attest,verifyEvidence,verifyRevision,contentDigest} from './evidence.mjs';
export {ActivityStore,activityScope,activityState,liveConnection} from './store.mjs';
export {activityFromAppMessage,verifyLegacyAppMessage,LEGACY_PURPOSE} from './legacy.mjs';
export {APP_MESSAGE,APP_MESSAGE_USAGE,APP_MESSAGES_MARKER,appMessageKey,appMessageUsageKey,itemRecord,itemPath,itemPrefixes,isItemKey,isAppMessageKey,usageKeyOf,migrateAppMessages} from './app-messages.mjs';
import {createFlags} from '../flags/evaluate.mjs';
/** New app exposure only; ctx carries the verified owner and creating client. */
export function activityEnabled(config={},ctx={}){const flags=(config?.flags??config?.FLAGS??createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env:config??{}})).for(ctx),result=flags.evaluate('ACTIVITY_V2_ENABLED');return result.value&&(result.reason!=='legacy-env'||flags.envState('ACTIVITY_V2_ENABLED').raw==='true');}
