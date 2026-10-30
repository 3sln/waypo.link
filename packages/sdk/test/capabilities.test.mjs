// Declaration validation and per-feature capability computation (components-profile
// decision note §4–§5, protocol §2, extensions revision 3.2 §2). Fixtures use .example hosts.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDeclaration,computeCapabilities,checkFloor,CapabilityStore,COMPONENTS_V1,EXT,declarationLimits,freshness} from '../src/capabilities.mjs';
import {componentsDeclaration} from '../src/testing.mjs';

const issuer='https://idp.example';
const floor={version:'0',issuer,authorization_endpoint:`${issuer}/authorize`,token_endpoint:`${issuer}/token`,rpc_endpoint:`${issuer}/rpc`,jwks_uri:`${issuer}/jwks`,authorization_request_endpoint:`${issuer}/requests`,preferences_contract:'https://contracts.example/preferences/v2',login_presentation:['redirect']};
const ext=(spec,options)=>options?{spec,options}:{spec};
const entry=(intents=['login','select-account','reauthenticate','end-session'],endpoint=`${issuer}/entries`)=>ext(EXT.authorizationEntry,{endpoint,intents});
const fedcm=ext(EXT.fedcm,{config_url:`${issuer}/fedcm.json`});
const components=(overrides={})=>ext(COMPONENTS_V1,{...componentsDeclaration(issuer),...overrides});
const full={...floor,login_presentation:['redirect','popup'],revocation_endpoint:`${issuer}/revoke`,dpop_signing_alg_values_supported:['ES256'],grant_types_supported:['authorization_code','refresh_token'],extensions:[entry(),fedcm,ext(EXT.clientIdMetadata),components()]};
const caps=(manifest,options)=>computeCapabilities(readDeclaration(manifest,issuer,{embedderOrigin:'https://app.example'}),options);
const replace=(list,spec,value)=>[...list.filter(item=>item.spec!==spec),...value?[value]:[]];

test('conformance floor: every required member fails closed with unsupported-provider',()=>{
  checkFloor(floor,issuer);
  for(const patch of [{version:'1'},{issuer:'https://other.example'},{login_presentation:['popup']},{login_presentation:'redirect'},{token_endpoint:'https://other.example/token'},{rpc_endpoint:undefined},{authorization_request_endpoint:`${issuer}/r#x`},{jwks_uri:'https://u:p@idp.example/jwks'},{preferences_contract:'http://contracts.example/p'},{preferences_contract:undefined}])
    assert.throws(()=>readDeclaration({...floor,...patch},issuer),{code:'unsupported-provider'},JSON.stringify(patch));
  assert.throws(()=>readDeclaration(null,issuer),{code:'unsupported-provider'});
});

test('minimal (floor only): identity-pinned redirect, nothing optional, issuer-root manage link',()=>{
  const c=caps(floor);
  assert.deepEqual({entry:c.entry,identityless:c.identityless,selectAccount:c.selectAccount,reauth:c.reauthenticate,end:c.endSession,popup:c.popup,fedcm:c.fedcm,revoke:c.revoke,dpop:c.dpop,profile:c.profile},{entry:false,identityless:false,selectAccount:false,reauth:false,end:false,popup:false,fedcm:false,revoke:false,dpop:false,profile:false});
  assert.equal(c.manageUrl,issuer+'/');assert.deepEqual(c.islands,{avatar:null,switcher:null,signIn:null});
});

test('standard and full compute per extension; FedCM needs the entry, the extension and the user agent',()=>{
  const standard=caps({...floor,login_presentation:['redirect','popup'],revocation_endpoint:`${issuer}/revoke`,extensions:[entry(['login','select-account'])]});
  assert.equal(standard.identityless,true);assert.equal(standard.selectAccount,true);assert.equal(standard.reauthenticate,false);assert.equal(standard.popup,true);assert.equal(standard.revoke,true);assert.equal(standard.dpop,false);
  const all=caps(full,{identityCredential:true,defaultIssuer:issuer});
  assert.equal(all.fedcm,true);assert.equal(all.dpop,true);assert.equal(all.clientIdMetadata,true);assert.equal(all.profile,true);assert.equal(all.manageUrl,`${issuer}/console/apps`);
  assert.deepEqual(all.islands.avatar,{version:1});assert.ok(all.islands.switcher);assert.ok(all.islands.signIn);
  assert.equal(caps(full,{identityCredential:false}).fedcm,false);
  // Prerequisite (extensions §2.5): fedcm without exactly one authorization-entry entry is absent.
  const lone=readDeclaration({...full,extensions:[fedcm]},issuer);
  assert.equal(lone.fedcm,null);assert.ok(lone.warnings.includes(EXT.fedcm));
  assert.equal(caps({...full,extensions:[fedcm]},{identityCredential:true}).fedcm,false,'fedcm requires authorization-entry');
  // DPoP needs ES256, the entry (it carries dpopJkt) and a refresh grant.
  assert.equal(caps({...full,grant_types_supported:['authorization_code']}).dpop,false);
  assert.equal(caps({...full,dpop_signing_alg_values_supported:['RS256']}).dpop,false);
});

test('entry intents: absent or invalid means none, never all; values outside the descriptor make the entry absent',()=>{
  const only=value=>caps({...floor,extensions:[value]});
  assert.equal(only(ext(EXT.authorizationEntry,{endpoint:`${issuer}/entries`})).entry,false);
  assert.equal(only(entry([])).entry,false);
  assert.equal(only(entry(['teleport'])).entry,false);
  assert.equal(only(entry(['login','teleport'])).entry,false,'a known option failing validation makes the entry absent');
  // Descriptor intents the SDK flows do not use (grant-more, configure) are kept on the declaration only.
  const more=readDeclaration({...floor,extensions:[entry(['login','grant-more'])]},issuer);
  assert.deepEqual(more.authorizationEntry.intents,['login','grant-more']);assert.deepEqual(computeCapabilities(more).intents,['login']);
  assert.equal(only(entry(['grant-more'])).entry,false,'no flow intent: the entry capability is off');
  assert.equal(only(entry(['login'],'https://other.example/entries')).entry,false,'endpoint options stay on the issuer origin');
  assert.equal(only(ext(EXT.fedcm,{config_url:'https://other.example/fedcm.json'})).fedcm,false);
});

test('extension processing: unknown ignored, duplicates and two versions absent, bounded, audience collisions',()=>{
  const declaration=readDeclaration({...floor,extensions:[entry(['login']),ext('https://spec.bindle.example/extensions/teleport/v1'),ext('not a url'),{spec:EXT.clientIdMetadata,extra:true}],unknown_member:{nested:true}},issuer);
  assert.deepEqual(declaration.authorizationEntry,{endpoint:`${issuer}/entries`,intents:['login']});assert.equal(declaration.clientIdMetadata,true);
  assert.deepEqual(Object.keys(declaration.extensions).sort(),[EXT.authorizationEntry,EXT.clientIdMetadata].sort());
  // Unknown option members are ignored and dropped.
  assert.deepEqual(readDeclaration({...floor,extensions:[ext(EXT.authorizationEntry,{endpoint:`${issuer}/entries`,intents:['login'],future:1})]},issuer).extensions[EXT.authorizationEntry],{endpoint:`${issuer}/entries`,intents:['login']});
  // Duplicate spec: every copy absent (and a dependent fedcm loses its prerequisite).
  const duplicate=readDeclaration({...floor,extensions:[entry(['login']),entry(['select-account']),fedcm]},issuer);
  assert.equal(duplicate.authorizationEntry,null);assert.equal(duplicate.fedcm,null);assert.ok(duplicate.warnings.includes(EXT.authorizationEntry));
  // Two versions of one line: all absent, even when the other version is unimplemented.
  const versions=readDeclaration({...floor,extensions:[entry(['login']),ext(EXT.authorizationEntry.replace(/v1$/,'v2'),{anything:true})]},issuer);
  assert.equal(versions.authorizationEntry,null);
  // Audience distinctness: an entry endpoint equal to a flat audience endpoint is absent.
  assert.equal(readDeclaration({...floor,extensions:[entry(['login'],floor.token_endpoint)]},issuer).authorizationEntry,null);
  // Bounds: an oversized entry is ignored; an oversized container is ignored as a whole.
  const oversize=readDeclaration({...floor,extensions:[{...entry(['login']),padding:'x'.repeat(declarationLimits.entryBytes)}]},issuer);
  assert.equal(oversize.authorizationEntry,null);
  const many=Array.from({length:declarationLimits.entries},(_,i)=>ext(`https://ext.example/f${i}/v1`));
  assert.equal(readDeclaration({...floor,extensions:[...many,entry()]},issuer).authorizationEntry,null,'more than 48 entries');
  assert.ok(readDeclaration({...floor,extensions:[...many.slice(1),entry()]},issuer).authorizationEntry,'48 entries are fine');
  assert.equal(readDeclaration({...floor,extensions:{[EXT.authorizationEntry]:{}}},issuer).authorizationEntry,null);
});

test('clean break: the former features and profiles containers are ignored entirely',()=>{
  const legacy={...full,extensions:undefined,features:{'authorization-entry.v1':{endpoint:`${issuer}/entries`,intents:['login','select-account']},'fedcm.v1':{config_url:`${issuer}/fedcm.json`},'client-id-metadata.v1':{},'intents.v1':{intents:['send-message'],login_endpoint:`${issuer}/console`}},profiles:{'https://3sln.me/artefacts/profiles/components/v1':{embed_origin:'https://embed.idp.example',protocol:[1],parts:{'sign-in':{versions:[1]}},credential_binding:['key-binding.v1']}}};
  const declaration=readDeclaration(legacy,issuer),c=computeCapabilities(declaration,{identityCredential:true});
  assert.deepEqual(declaration.extensions,{});assert.equal(declaration.authorizationEntry,null);assert.equal(declaration.components,null);
  assert.deepEqual({entry:c.entry,fedcm:c.fedcm,clientIdMetadata:c.clientIdMetadata,profile:c.profile,intentLinks:c.intentLinks},{entry:false,fedcm:false,clientIdMetadata:false,profile:false,intentLinks:undefined});
  // Alongside `extensions`, legacy containers neither add nor remove anything.
  assert.deepEqual(readDeclaration({...full,features:{},profiles:{}},issuer).extensions,readDeclaration(full,issuer).extensions);
});

test('embedded components: options map to islands; validation, binding and cross-checks remove only what fails',()=>{
  const profile=overrides=>caps({...full,extensions:replace(full.extensions,COMPONENTS_V1,components(overrides))},{identityCredential:true,defaultIssuer:issuer});
  const declared=readDeclaration(full,issuer,{embedderOrigin:'https://app.example'}).components;
  assert.deepEqual(declared,{embedOrigin:'https://embed.idp.example',parts:{avatar:{version:1},'account-switcher':{version:1},'sign-in':{version:1}},bindings:['key-binding.v1'],manageUrl:`${issuer}/console/apps`});
  // embed_origin is exempt from the issuer-origin rule (a sibling origin is fine) but still a bare HTTPS origin.
  for(const bad of [{embed_origin:issuer},{embed_origin:'https://app.example'},{embed_origin:'https://embed.idp.example/path'},{embed_origin:'http://embed.idp.example'},{embed_origin:'https://10.0.0.1'},{protocol:[2]},{protocol:[]},{parts:'x'},{parts:[]},{parts:['teleporter/1']},{parts:['avatar/9']},{credential_binding:['other.v9']}])
    assert.equal(profile(bad).profile,false,JSON.stringify(bad));
  assert.equal(profile({embed_origin:'https://components.cdn.example'}).embedOrigin,'https://components.cdn.example');
  // No binding: identity-bearing parts are absent, sign-in remains.
  const unbound=caps({...full,extensions:replace(full.extensions,COMPONENTS_V1,ext(COMPONENTS_V1,componentsDeclaration(issuer,{binding:false})))},{defaultIssuer:issuer});
  assert.equal(unbound.islands.avatar,null);assert.equal(unbound.islands.switcher,null);assert.ok(unbound.islands.signIn);
  // Only the declared parts; the request part is carried for the request element.
  const parts=profile({parts:['sign-in/1','request/1']});assert.equal(parts.islands.avatar,null);assert.equal(parts.islands.signIn.version,1);
  assert.deepEqual(readDeclaration({...full,extensions:replace(full.extensions,COMPONENTS_V1,components({parts:['request/1']}))},issuer).components.parts,{request:{version:1}});
  // Without identity-optional login, flow parts are absent.
  assert.equal(caps({...full,extensions:replace(full.extensions,EXT.authorizationEntry,entry(['select-account']))}).islands.signIn,null);
  // manage_url is a public endpoint option on the issuer origin: off-origin makes the whole entry absent.
  assert.equal(profile({manage_url:'https://evil.example/apps'}).profile,false);
  const {manage_url:_,...noManage}=componentsDeclaration(issuer),unmanaged=caps({...full,extensions:replace(full.extensions,COMPONENTS_V1,ext(COMPONENTS_V1,noManage))});assert.equal(unmanaged.profile,true);assert.equal(unmanaged.manageUrl,issuer+'/');
  // Rev 3.3 (§2.7, CR-X3-33): no theme_tokens option and no per-part FedCM. A legacy theme_tokens member is ignored, the
  // capability set carries no token list, and parts carry only their version.
  const legacyMembers=profile({theme_tokens:['surface','radius']});assert.equal(legacyMembers.profile,true);assert.equal('themeTokens' in legacyMembers,false);
  assert.deepEqual(legacyMembers.islands.signIn,{version:1},'no part delegates FedCM');assert.deepEqual(legacyMembers.islands.avatar,{version:1});
});

test('island policy: auto by default, off disables, an allowlist restricts to listed issuers',()=>{
  assert.equal(caps(full).profile,true);
  assert.equal(caps(full,{islands:'off'}).profile,false);
  assert.equal(caps(full,{islandIssuers:['https://other.example']}).profile,false);
  assert.equal(caps(full,{islandIssuers:[issuer]}).profile,true);
});

test('runtime degradation is per issuer, dependent flags inherit it, and it never reverses',()=>{
  const store=new CapabilityStore(),other='https://other.example',events=[];
  store.subscribe(value=>events.push(value));
  store.remember(readDeclaration(full,issuer,{}));store.remember(readDeclaration({...full,issuer:other,...Object.fromEntries(['authorization_endpoint','token_endpoint','rpc_endpoint','jwks_uri','authorization_request_endpoint','revocation_endpoint'].map(key=>[key,full[key].replace(issuer,other)])),extensions:[ext(EXT.authorizationEntry,{endpoint:`${other}/entries`,intents:['login']})]},other,{}));
  store.degrade(issuer,'authorization-entry');
  const degraded=store.capabilities(issuer,{identityCredential:true});
  assert.equal(degraded.entry,false);assert.equal(degraded.fedcm,false,'fedcm depends on the entry');assert.equal(degraded.dpop,false);assert.equal(degraded.islands.signIn,null);
  assert.equal(store.capabilities(other).entry,true,'no cross-issuer degradation');
  store.remember(readDeclaration(full,issuer,{}));assert.equal(store.capabilities(issuer).entry,false,'a refetch never reverses a degradation');
  store.degrade(issuer,'part:avatar');assert.equal(store.capabilities(issuer).islands.avatar,null);
  assert.deepEqual(events,[issuer,other,issuer,issuer]);
});

test('declarations are cached for the HTTP freshness lifetime, capped at one hour',()=>{
  let now=0;const store=new CapabilityStore({clock:()=>now}),declaration=readDeclaration(floor,issuer);
  const headers=value=>({headers:{get:()=>value}});
  assert.equal(freshness(headers('max-age=999999')),3600000);assert.equal(freshness(headers('no-store')),0);assert.equal(freshness(headers(null)),300000);
  store.remember(declaration,freshness(headers('max-age=60')));
  assert.ok(store.declaration(issuer));now=61000;assert.equal(store.declaration(issuer),null);assert.ok(store.declaration(issuer,{stale:true}));
  assert.ok(Object.isFrozen(declaration)&&Object.isFrozen(declaration.extensions));
});

// Found by the multi-provider simulation (tests/sim): a provider answering `Cache-Control: no-cache` gives a declaration
// lifetime of 0; callers that have just discovered may still read the manifest as stale.
test('manifest reads support stale access for zero-lifetime declarations',async()=>{
 const {CapabilityStore}=await import('../src/capabilities.mjs');
 let now=1000;const store=new CapabilityStore({clock:()=>now}),manifest={issuer:'https://provider.example'};
 store.remember({issuer:'https://provider.example'},0,manifest);
 assert.equal(store.manifest('https://provider.example'),null);
 assert.deepEqual(store.manifest('https://provider.example',{stale:true}),manifest);
 assert.ok(store.declaration('https://provider.example',{stale:true}));
});
