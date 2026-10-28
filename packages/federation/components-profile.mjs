import {capability} from '../flags/read.mjs';
import {EXT,declare} from '../core/extensions.mjs';
// 3sln.me components profile (provider-operated components: frame, islands, key-bound embed credentials). It is a
// 3sln.me-defined sub-spec, not part of the Bindle protocol (docs/profiles/components-v1.md). This module is the
// only place that knows the declaration members: logic reads configured values through componentsProfile() and
// advertises through componentsDeclaration(). Origins are always configured per instance.
// Extensions rev 3.2: declared as the Bindle-owned embedded-components extension; the profile URL stays the content's
// identifier until republication (CR-X3-16).
export const COMPONENTS_PROFILE='https://3sln.me/artefacts/profiles/components/v1',COMPONENTS_EXTENSION=EXT.embeddedComponents;
export const COMPONENTS_PROTOCOL=[1];
// Parts the islands shell implements (profile §2, SDK islands-protocol PARTS). FedCM is not implemented, so no part
// declares it; `key-binding.v1` is the embed credential binding implemented by the federation service. Theme tokens
// stay undeclared (islands use provider defaults) until the shell's token handling has evidence.
export const COMPONENTS_PARTS={avatar:{versions:[1]},'account-switcher':{versions:[1]},'sign-in':{versions:[1]}};
/** Configured values for this provider instance, or null when components are not offered. Profile §2: a dedicated
 * HTTPS origin without an IP literal; loopback http/IP origins are accepted only under LOCAL_DEVELOPMENT. A
 * misconfigured value disables components (no embed routes, no declaration) instead of failing every request. */
export function componentsProfile(config){
 const embedOrigin=config?.EMBED_ORIGIN;if(!capability(config,'FEDERATION_ENTRY_ENABLED')||!embedOrigin)return null;
 let url;try{url=new URL(embedOrigin);}catch{return null;}
 const local=config.LOCAL_DEVELOPMENT==='true',ip=/^\[|^\d+(?:\.\d+){3}$/.test(url.hostname);
 if(url.origin!==embedOrigin||url.origin===config.APP_ORIGIN||!local&&(url.protocol!=='https:'||ip)||local&&!['https:','http:'].includes(url.protocol))return null;
 return {profile:COMPONENTS_PROFILE,embedOrigin};
}
/** The embedded-components extension declaration (extensions rev 3.2 §2.7, §2.8; EXT3-29 provisional): the profile's
 * members as options. The nested `parts` map becomes `<name>/<version>` enum values (options are atomic, §2.4).
 * `{}` when components are not offered. */
export function componentsDeclaration(profile,{manageUrl,incremental=false}={}){
 if(!profile)return {};
 const parts=[...Object.entries(COMPONENTS_PARTS),...incremental?[['request',{versions:[1]}]]:[]].flatMap(([name,part])=>part.versions.map(v=>`${name}/${v}`));
 return {extensions:[declare(EXT.embeddedComponents,{embed_origin:profile.embedOrigin,protocol:[...COMPONENTS_PROTOCOL],parts,credential_binding:['key-binding.v1'],...manageUrl?{manage_url:manageUrl}:{}})]};
}
