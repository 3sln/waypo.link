import {capability} from '../flags/read.mjs';
import {EXT,declare} from '../core/extensions.mjs';
// Embedded components (provider-operated islands and key-bound embed credentials): the Bindle-owned embedded-components
// extension, whose content is the components profile pending republication (docs/profiles/components-v1.md). This module is the
// only place that knows the declaration members: logic reads configured values through componentsProfile() and
// advertises through componentsDeclaration(). Origins are always configured per instance.
// Extensions rev 3.3 (§2.7, §2.8; CR-X3-16): declared only as the Bindle-owned embedded-components extension. The former
// profile URL (https://3sln.me/artefacts/profiles/components/v1) is withdrawn: never emitted, never read.
export const COMPONENTS_EXTENSION=EXT.embeddedComponents;
export const COMPONENTS_PROTOCOL=[1];
// Parts the islands shell implements (SDK islands-protocol PARTS). Rev 3.3 (§2.7, CR-X3-33, provisional): no per-part
// FedCM (islands never delegate to FedCM) and no `theme_tokens` (islands use provider defaults); `key-binding.v1` is the
// embed credential binding implemented by the federation service.
export const COMPONENTS_PARTS={avatar:{versions:[1]},'account-switcher':{versions:[1]},'sign-in':{versions:[1]}};
/** Configured values for this provider instance, or null when components are not offered. Profile §2: a dedicated
 * HTTPS origin without an IP literal; loopback http/IP origins are accepted only under LOCAL_DEVELOPMENT. A
 * misconfigured value disables components (no embed routes, no declaration) instead of failing every request. */
export function componentsProfile(config){
 const embedOrigin=config?.EMBED_ORIGIN;if(!capability(config,'FEDERATION_ENTRY_ENABLED')||!embedOrigin)return null;
 let url;try{url=new URL(embedOrigin);}catch{return null;}
 const local=config.LOCAL_DEVELOPMENT==='true',ip=/^\[|^\d+(?:\.\d+){3}$/.test(url.hostname);
 if(url.origin!==embedOrigin||url.origin===config.APP_ORIGIN||!local&&(url.protocol!=='https:'||ip)||local&&!['https:','http:'].includes(url.protocol))return null;
 return {embedOrigin};
}
/** The embedded-components extension declaration (extensions rev 3.2 §2.7, §2.8; EXT3-29 provisional): the profile's
 * members as options. The nested `parts` map becomes `<name>/<version>` enum values (options are atomic, §2.4).
 * `{}` when components are not offered. */
export function componentsDeclaration(profile,{manageUrl,incremental=false}={}){
 if(!profile)return {};
 const parts=[...Object.entries(COMPONENTS_PARTS),...incremental?[['request',{versions:[1]}]]:[]].flatMap(([name,part])=>part.versions.map(v=>`${name}/${v}`));
 return {extensions:[declare(EXT.embeddedComponents,{embed_origin:profile.embedOrigin,protocol:[...COMPONENTS_PROTOCOL],parts,credential_binding:['key-binding.v1'],...manageUrl?{manage_url:manageUrl}:{}})]};
}
