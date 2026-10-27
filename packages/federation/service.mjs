import {contractMethods} from '../core/contract-methods.mjs';
import {contractReferences} from './integrations.mjs';
import {artefactURL} from '../core/artefacts.mjs';
import {AppAction,AppQuery} from '../app/engine.mjs';
import {rpcCreatesContentOrGrant} from '../identity/age-policy.mjs';
import {syncEventReaders} from './event-readers.mjs';
import {APP_NOTIFICATIONS,ACTIVITY_METHODS,originBoundContract,hasAdmissionMethod,notificationInput} from './app-notifications.mjs';
import {FederationObjectURLs} from './object-urls.mjs';
import {objectKey} from '../storage/policy.mjs';
import { digest, base64url, boundedString, canonical } from '../messaging/store.mjs';
import { fail, exact, https, strings, object, pinSchema, validateValue } from './schema.mjs';
import {DPOP_TYP,verifyProof,dpopNonces,consumeProof,jktPattern} from './dpop.mjs';
import {APP_SESSION,appRefreshIdleMs,appAccessMs,issueAppAccess,expiresIn,createAppSession,lineageLive,rotateBound,revokeFamily,revokeToken} from './app-sessions.mjs';
import {mintClaim,linkExchange,redeemClaim,startSession,sessionState,forget,sessionAvatar,openStream,streamTick,endSession} from './embed-bindings.mjs';
import {reauthenticationFresh} from './authorization-entries.mjs';
import {validClientSnapshot} from './client-metadata.mjs';
import {withClientPolicies} from './legal.mjs';
export const PREFERENCES='https://3sln.me/artefacts/contracts/preferences/v1';
/** EXT-X8 (AMD-C9): uniform resource references with brokered credentials; served only with a mounted brokering port. */
export const PREFERENCES_V2='https://3sln.me/artefacts/contracts/preferences/v2';
export const PROFILE='https://3sln.me/artefacts/contracts/profile/v1';
export const DESCRIPTOR='https://3sln.me/artefacts/contracts/resource-descriptor/v1';
const key=(kind,id)=>`federation/${kind}/${id}`;
const copy=value=>structuredClone(value);
const own=(dictionary,name)=>Object.hasOwn(dictionary??{},name)?dictionary[name]:undefined;
const reference=value=>object(value)?value.resource:value;
const normalizeScope=value=>{let prefix;if(value?.prefix){if(typeof value.prefix!=='string')fail('invalid_preferences');prefix=value.prefix.replace(/\/$/,'');try{objectKey(prefix);}catch{fail('invalid_preferences');}}return {...prefix?{prefix}:{},...value?.readOnly===true?{readOnly:true}:{},...value?.maxObjectBytes!==undefined?{maxObjectBytes:value.maxObjectBytes}:{}};};
const scope=value=>normalizeScope(object(value)?value.scope:{});
const assignmentAuthority=(field,values,name)=>Object.hasOwn(values??{},name)?asList(field,values[name]).map(value=>({resource:reference(value),scope:scope(value)})).sort((a,b)=>a.resource.localeCompare(b.resource)):[];
const scopeAllows=(value,method,args)=>{if(method==='presign'&&(value.prefix||value.maxObjectBytes))return false;if(value.readOnly&&(['put','delete'].includes(method)||method==='presign'&&args.operation==='write'))return false;if(value.prefix&&args.key!==undefined){if(typeof args.key!=='string')return false;const prefix=value.prefix.replace(/\/$/,'');if(args.key!==prefix&&!args.key.startsWith(prefix+'/'))return false;}if(value.maxObjectBytes&&method==='put'&&typeof args.dataBase64==='string'&&Math.floor(args.dataBase64.length*3/4)-(args.dataBase64.endsWith('==')?2:args.dataBase64.endsWith('=')?1:0)>value.maxObjectBytes)return false;return true;};
const assignedRefs=(field,value)=>asList(field,value).map(reference);
const asList=(field,value)=>(field.cardinality?.max??1)===1?[value]:value;
/** Wargame 2026-10-23 #4 (provisional): pending-request budgets. Owner-bound requests (entry requests and anonymous
 * requests after the owner step) keep the original 32; anonymous pre-owner requests have their own per-caller-and-client
 * and per-shard bounds and never count against the owner. */
/** How long a redeemed code's tombstone lets a replay revoke the first redemption's tokens. */
export const CODE_REPLAY_WINDOW_MS=600000;
/** Live brokered-introspection assertion jtis kept per owner shard. */
export const ASSERTION_REPLAY_ROWS=1024;
export const OWNER_REQUESTS=32,ANONYMOUS_REQUESTS_PER_CALLER=8,ANONYMOUS_REQUESTS_PER_NETWORK=16,ANONYMOUS_REQUESTS_PER_ALLOCATION=64,ANONYMOUS_REQUESTS_PER_SHARD=512;
export class FederationService {
  constructor({store,crypto=globalThis.crypto,clock=()=>Date.now(),issuer,clients=[],contractVersion,pinContract,schemaFetcher,schemaHosts=[],authenticateOwner,dispatchCapability,allowInsecureLocalhost=false,routingKey,validateSubject,resourceProvider,connections,refreshEnabled=false,objectURLs,dpop,embedView,embedOrigin,clientMetadata=false,appSessions,brokering,integrations=false,termsAllowed,relationImports}){
    // ORG-10d (spec organizations §10): {certify(input)} over the organization's account writer (relations.certify).
    // Imported resources are mirrored as resources with provider 'relation'; preferences/v2 projects them in relay form
    // with an entity certificate as the token, and they are never dispatched here.
    this.relationImports=typeof relationImports?.certify==='function'?relationImports:null;
    // EXT-X8: {enabled, mint(input), seq?(input)} over the owner's account (federation/introspection.mjs), composed only
    // with INTEGRATIONS_ENABLED and BROKERING_ENABLED; without it preferences/v2 is not served.
    this.contractVersion=contractVersion;this.pinContract=pinContract;this.integrations=integrations===true;this.brokering=brokering?.enabled===true&&typeof brokering.mint==='function'?brokering:null;
    this.appSessions=appSessions;this.clientMetadata=clientMetadata===true;this.dpopNonces=dpop?.secret?dpopNonces({secret:dpop.secret,crypto,clock}):null;this.embedView=embedView;this.embedOrigin=embedOrigin;
    this.objectURLService=objectURLs?.sign&&objectURLs?.verify?new FederationObjectURLs(this,objectURLs):null;this.refreshEnabled=refreshEnabled===true;this.connections=connections;this.routingKey=routingKey;this.validateSubject=validateSubject;this.resourceProvider=resourceProvider;if(routingKey&&!/^[a-f0-9-]{36}$/.test(routingKey))fail('invalid_config');this.allowInsecureLocalhost=allowInsecureLocalhost;const origin=this.url(issuer).origin;if(origin!==issuer)fail('invalid_config','Issuer must be an HTTPS origin.');
    Object.assign(this,{store,crypto,clock,issuer,schemaFetcher,schemaHosts,authenticateOwner,dispatchCapability,termsAllowed});this.audience=`${issuer}/bindle/rpc`;this.clients=new Map();
    for(const client of clients){this.url(client.id);const origin=this.url(client.origin).origin;if(origin!==client.origin||!boundedString(client.name,100)||!boundedString(client.id,200))fail('invalid_config');strings(client.redirectUris,16);if(!client.redirectUris.length)fail('invalid_config');for(const uri of client.redirectUris){if(this.url(uri).origin!==origin)fail('invalid_config');}if(this.clients.has(client.id))fail('invalid_config');this.clients.set(client.id,copy(withClientPolicies(client)));}
    this.staticClients=new Set(this.clients.keys());
    // ORG-3: optional engine-backed live authority port, composed by ORG-4 for member contexts only.
    if(arguments[0].organizations)arguments[0].organizations.attach(this);else{const load=this.tokenRecord.bind(this);this.tokenRecord=(tx,record)=>{if(record?.member)fail('forbidden');return load(tx,record);};}
  }
  /** Metadata-document clients (client-id-metadata.v1). The resolving adapter attaches a validated snapshot to the
   * pending request; only the owner's approval persists it (bounded per owner), so codes, refresh and RPC keep
   * working without refetching. Reviewed static clients always take precedence; with the feature disabled no
   * snapshot is loaded or accepted. */
  ensureClients(){if(!this.clientMetadata)return;this.clientsLoaded??=this.store.transaction(async tx=>{for(const {value} of await tx.list(key('client','')))if(!this.staticClients.has(value?.id)&&validClientSnapshot(value,{integrations:this.integrations,artefactVersions:this.artefactVersions}))this.clients.set(value.id,copy(value));}).catch(error=>{this.clientsLoaded=undefined;throw error;});return this.clientsLoaded;}
  snapshot(clientId,client){if(client===undefined||this.staticClients.has(clientId))return undefined;if(!this.clientMetadata||client?.id!==clientId||!validClientSnapshot(client,{integrations:this.integrations,artefactVersions:this.artefactVersions}))fail('invalid_client','Unregistered application or redirect.');return copy(client);}
  requestClient(request){return this.staticClients.has(request.clientId)?this.clients.get(request.clientId):request.client??this.clients.get(request.clientId);}
  async persistClient(tx,request){if(!request.client||this.staticClients.has(request.clientId))return;const name=key('client',encodeURIComponent(request.clientId));if(!await tx.get(name)&&(await tx.list(key('client',''))).length>=128)fail('rate_limited','This account has connected too many unreviewed applications.');await tx.set(name,copy(request.client));}
  url(value){try{return https(value);}catch(error){if(!this.allowInsecureLocalhost)throw error;let url;try{url=new URL(value);}catch{throw error;}if(url.protocol!=='http:'||url.hostname!=='localhost'||url.username||url.password||url.hash||url.href!==value&&url.origin!==value)throw error;return url;}}
  random(){return `${this.routingKey?this.routingKey+'.':''}${base64url(this.crypto.getRandomValues(new Uint8Array(32)))}`;}
  opaque(value){return typeof value==='string'&&new RegExp(`^${this.routingKey?this.routingKey.replaceAll('-','\\-')+'\\.':''}[A-Za-z0-9_-]{43}$`).test(value);}
  async active(subject,epoch){if(this.validateSubject&&await this.validateSubject(subject,epoch)!==true)fail('unauthorized');}
  async syncResources(subject){if(!this.resourceProvider)return;const prior=this.resourceSyncTail??Promise.resolve();const work=prior.catch(()=>{}).then(()=>this.performResourceSync(subject));this.resourceSyncTail=work;return work;}
  // ORG-10d/10f: with a `relationImports` port the provider's relation descriptors (relationImportDescriptors) are the
  // source of truth for provider 'relation' rows, so a stale import mirror is removed; without one they are kept.
  async performResourceSync(subject){const resources=await this.resourceProvider(subject);if(!Array.isArray(resources)||resources.length>200)fail('temporarily_unavailable');await this.store.transaction(async tx=>{const changed=new Set();const live=new Set();for(const resource of resources){if(!resource||typeof resource.id!=='string'||!object(resource.contracts))fail('invalid_resource');this.url(resource.id);live.add(resource.id);const previous=await tx.get(key('resource',resource.id));if(previous&&canonical(previous)!==canonical({...resource,owner:subject}))changed.add(resource.id);await tx.set(key('resource',resource.id),{...copy(resource),owner:subject});}for(const row of await tx.list(key('resource','')))if(row.value.owner===subject&&!live.has(row.value.id)&&(row.value.provider!=='relation'||this.relationImports)){changed.add(row.value.id);await tx.delete(row.key);}if(changed.size)for(const row of await tx.list(key('preferences',`${subject}|`))){const schema=(await this.schemaRecord(tx,row.value.fragment))?.schema;if(schema&&Object.entries(schema.fields).some(([name,field])=>field.type==='resource'&&Object.hasOwn(row.value.values,name)&&assignedRefs(field,row.value.values[name]).some(id=>changed.has(id))))await tx.set(row.key,{...row.value,revision:this.random()});}});}
  async owner(authority,tx){if(typeof this.authenticateOwner!=='function')fail('unauthorized');const identity=await this.authenticateOwner(authority,tx);if(!identity?.subject||this.url(identity.subject).origin!==this.issuer)fail('unauthorized');if(this.routingKey&&identity.subject!==`${this.issuer}/entities/${this.routingKey}`)fail('forbidden');await this.active(identity.subject,identity.epoch);return identity.subject;}
  async bounded(tx,kind,max,{count=()=>true}={}){const now=this.clock();const rows=await tx.list(key(kind,''));let live=0;for(const row of rows){if(row.value.expiresAt<=now||kind==='request'&&row.value.status!=='pending'||kind==='grant'&&!row.value.active)await tx.delete(row.key);else if(count(row.value))live++;}if(live>=max)fail('rate_limited','This account has too many outstanding authorizations.');}
  get artefactVersions(){return this.schemaFetcher?.artefacts?.enabled===true;}
  async schema(fragment){
    let target=fragment;if(this.artefactVersions&&typeof fragment==='string'){try{artefactURL(fragment);target={fragment};}catch{}}
    const pinned=await pinSchema(this,target);if(!this.artefactVersions||!pinned.version)return pinned;
    const url=typeof fragment==='string'?fragment:fragment.fragment??fragment.artefact;
    let first=pinned;if(pinned.version>1){let hash=pinned.digest,record;for(let n=pinned.version;n>=1;n--){record=await this.schemaFetcher.artefacts.record(hash);if(!record)fail('artefact_unavailable');if(n>1)hash=record.prev;}first=await pinSchema(this,{fragment:url,version:1,digest:hash});}
    await this.store.transaction(async tx=>{await tx.set(key('schema-version',`${url}|${pinned.digest}`),pinned);await tx.set(key('schema-version',`${url}|${first.digest}`),first);const legacy=await tx.get(key('schema',url));if(legacy&&canonical(legacy.schema)===canonical(first.schema))await tx.set(key('schema-version',`${url}|${legacy.digest}`),{...first,digest:legacy.digest});const head=await tx.get(key('schema-head',url));if(!head||head.version<pinned.version)await tx.set(key('schema-head',url),pinned);});return pinned;
  }
  async schemaRecord(tx,fragment){return (await tx.get(key('schema-head',fragment)))??await tx.get(key('schema',fragment));}
  async referenceMatches(tx,fragment,pin,head){
    if(!head)return false;if(pin.digest===head.digest)return true;if(!this.artefactVersions&&!pin.version&&!head.version)return false;if(!pin.version&&!head.version)return String(pin.digest).replace(/^sha256-/,'')===String(head.digest).replace(/^sha256-/,'');if(!head.version)return false;
    const stored=(await tx.get(key('schema-version',`${fragment}|${pin.digest}`)))??(!pin.version?await tx.get(key('schema-version',`${fragment}|${String(pin.digest).replace(/^sha256-/,'')}`)):null);return !!stored&&(pin.version===undefined||stored.version===pin.version)&&stored.version<=head.version;
  }
  client(clientId,redirectUri,snapshot){const client=snapshot??this.clients.get(clientId);if(!client||!client.redirectUris.includes(redirectUri))fail('invalid_client','Unregistered application or redirect.');return client;}
  async beginAuthorization(input,options={}){
    exact(input,['clientId','redirectUri','challenge','challengeMethod','state','requests']);const snapshot=this.snapshot(input.clientId,options?.client),client=this.client(input.clientId,input.redirectUri,snapshot);
    if(input.challengeMethod!=='S256'||typeof input.challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.challenge)||!boundedString(input.state,512)||!Array.isArray(input.requests)||input.requests.length>8)fail('invalid_request');
    const requests=await this.pinRequests(input.requests);
    // Wargame 2026-10-23 #4: an anonymous request names an owner only by public handle, so it never spends that owner's
    // budget. It is held as pre-owner (`anonymous`) under its own bounds, per caller (IP pseudonym from the route) and
    // client and per shard, and binds to the owner budget only at the owner step (`bindOwner`).
    const supplied=typeof options?.caller==='string'&&options.caller.length<=128?options.caller:'unknown',[caller,allocation=caller]=supplied.split('.',2);
    // `<network>.<allocation>` from the route: 64 per IPv6 /48 (or IPv4 /24) across its networks and clients.

    // `caller` is the route's network pseudonym (IPv6 /64, IPv4 /24; review 2026-10-23): 8 per network and client, and
    // 16 per network across all clients, so one network cannot fill a shard by cycling client IDs.
    const requestId=this.random();await this.store.transaction(async tx=>{await this.bounded(tx,'request',ANONYMOUS_REQUESTS_PER_CALLER,{count:row=>row.anonymous?.caller===caller&&row.clientId===input.clientId});await this.bounded(tx,'request',ANONYMOUS_REQUESTS_PER_NETWORK,{count:row=>row.anonymous?.caller===caller});await this.bounded(tx,'request',ANONYMOUS_REQUESTS_PER_ALLOCATION,{count:row=>(row.anonymous?.allocation??row.anonymous?.caller)===allocation});const total=(await tx.list(key('request',''))).filter(row=>row.value.anonymous).length;if(total>=ANONYMOUS_REQUESTS_PER_SHARD)fail('temporarily_unavailable','Too many sign-in requests are waiting. Try again shortly.');return tx.set(key('request',requestId),{...copy(input),...snapshot?{client:snapshot}:{},requests,requestId,anonymous:{caller,allocation},expiresAt:this.clock()+600000,status:'pending'});});return {requestId,view:{client:copy(client),requests:requests.map(({schema,digest,...request})=>({...request,schema,digest})),issuer:this.issuer}};
  }
  async pinRequests(list){
    const requests=[];
    for(const request of list){exact(request,['fragment','required','purpose','fields','methods',...this.artefactVersions?['version','digest','contract_versions']:[]]);if(typeof request.required!=='boolean'||!boundedString(request.purpose,1000))fail('invalid_request');strings(request.fields,32);if(!request.fields.length||requests.some(r=>r.fragment===request.fragment))fail('invalid_request');const pinned=await this.schema(this.artefactVersions&&(request.version!==undefined||request.digest!==undefined)?{fragment:request.fragment,...request.version!==undefined?{version:request.version}:{},...request.digest!==undefined?{digest:request.digest}:{}}:request.fragment);const methods=request.methods??{};if(!object(methods))fail('invalid_request');
      for(const name of request.fields){if(!Object.hasOwn(pinned.schema.fields,name))fail('invalid_request');}
      for(const [name,contracts] of Object.entries(methods)){if(!request.fields.includes(name)||pinned.schema.fields[name].type!=='resource'||!object(contracts))fail('invalid_request');for(const [contract,list] of Object.entries(contracts)){if(!pinned.schema.fields[name].contracts.includes(contract))fail('invalid_request');strings(list,32);if(!list.length||list.some(method=>!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(method)))fail('invalid_request');}}
      let contract_versions;if(this.artefactVersions){if(request.contract_versions!==undefined&&!object(request.contract_versions))fail('invalid_request');contract_versions={};const contracts=[...new Set(Object.values(methods).flatMap(cs=>Object.keys(cs)))];if(request.contract_versions&&Object.keys(request.contract_versions).some(c=>!contracts.includes(c)))fail('invalid_request');for(const contract of contracts){if(typeof this.pinContract!=='function')fail('artefact_unavailable');const ref=request.contract_versions?.[contract];if(ref)exact(ref,['version','digest']);const pin=await this.pinContract(ref?{contract,...ref}:contract);contract_versions[contract]=contractReferences({[contract]:pin})[contract];if(Object.values(methods).some(cs=>cs[contract]?.some(m=>!Object.hasOwn(contractMethods(pin.schema),m))))fail('invalid_request');}}
      requests.push({...copy(request),...contract_versions?{contract_versions}:{},methods:copy(methods),digest:pinned.digest,...pinned.version?{version:pinned.version}:{},schema:pinned.schema});
    }
    return requests;
  }
  async entryIdentity(authority,{epoch=false}={}){const identity=await this.authenticateOwner(authority),subject=await this.owner(authority);return {subject,authTime:Number.isSafeInteger(identity?.authTime)?identity.authTime:null,...epoch?{epoch:identity.epoch}:{}};}
  /** Owner-shard half of a provider-owned authorization entry. The entry store has
   * already durably recorded this owner and requestId; retries resume the request. */
  async beginEntryAuthorization(authority,input,options={}){
    exact(input,['requestId','entry']);const entry=input.entry;exact(entry,['entryHash','clientId','redirectUri','challenge','state','requests','digests','intent','subjectConstraint','maxAge','authAfter','delivery','dpopJkt','embedJkt']);
    if(!this.opaque(input.requestId)||!/^[A-Za-z0-9_-]{43}$/.test(entry.entryHash??'')||!['login','select-account','reauthenticate'].includes(entry.intent)||!['redirect','popup','embed-popup'].includes(entry.delivery)||entry.dpopJkt!==undefined&&!jktPattern.test(entry.dpopJkt)||(entry.embedJkt!==undefined)!==(entry.delivery==='embed-popup')||entry.embedJkt!==undefined&&!jktPattern.test(entry.embedJkt))fail('invalid_request');
    const snapshot=this.snapshot(entry.clientId,options?.client),client=this.client(entry.clientId,entry.redirectUri,snapshot);if(typeof entry.challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(entry.challenge)||!boundedString(entry.state,512)||!Array.isArray(entry.requests)||entry.requests.length>8)fail('invalid_request');
    const {subject,authTime,epoch}=await this.entryIdentity(authority,{epoch:true});
    if((entry.intent==='reauthenticate')!==(entry.authAfter!==undefined))fail('invalid_request');
    if(entry.intent==='reauthenticate'){if(entry.subjectConstraint!==subject)fail('account_mismatch','Sign in to the account this application asked about.');if(!reauthenticationFresh(authTime,entry,this.clock()))fail('reauthentication_required','Sign in again to confirm this account.');}
    const requests=await this.pinRequests(entry.requests);if(entry.digests!==undefined&&(!Array.isArray(entry.digests)||entry.digests.length!==requests.length||requests.some((r,n)=>r.digest!==entry.digests[n])))fail('schema_changed','Immutable fragment changed; use a new URL.');
    const binding={entryHash:entry.entryHash,intent:entry.intent,delivery:entry.delivery,...entry.dpopJkt?{dpopJkt:entry.dpopJkt}:{},...entry.embedJkt?{embedJkt:entry.embedJkt}:{},...entry.intent==='reauthenticate'?{subjectConstraint:entry.subjectConstraint,maxAge:entry.maxAge,authAfter:entry.authAfter}:{}};
    const approved=await this.store.transaction(async tx=>{const existing=await tx.get(key('request',input.requestId));if(existing){if(existing.entry?.entryHash!==entry.entryHash)fail('invalid_request');}else{await this.bounded(tx,'request',OWNER_REQUESTS,{count:row=>!row.anonymous});await tx.set(key('request',input.requestId),{clientId:entry.clientId,redirectUri:entry.redirectUri,challenge:entry.challenge,challengeMethod:'S256',state:entry.state,requests,...snapshot?{client:snapshot}:{},requestId:input.requestId,entry:binding,expiresAt:this.clock()+600000,status:'pending'});}return this.priorApproval(tx,subject,epoch,entry.clientId,requests);});
    return {requestId:input.requestId,view:{client:copy(client),requests:requests.map(({schema,digest,...request})=>({...request,schema,digest})),issuer:this.issuer},...approved?{approved}:{}};
  }
  /** "Already approved" (adaptive-app-sign-in R1): when every requested fragment is covered by a live grant of this
   * owner to this client (same digest and epoch, all requested fields and methods, resources still assigned with the
   * granted generation and scope), the
   * selections that resubmit that access. Provider-page data only; `approve` re-validates everything. */
  async priorApproval(tx,subject,epoch,clientId,requests){
    if(!requests.length)return null;const approved=[],grants=(await tx.list(key('grant',''))).map(row=>row.value).filter(grant=>grant.active&&grant.subject===subject&&grant.clientId===clientId&&grant.epoch===epoch);
    for(const r of requests){
      const preferences=await tx.get(key('preferences',`${subject}|${r.fragment}`));if(!preferences||!await this.referenceMatches(tx,r.fragment,r,preferences))return null;let found=null;
      for(const grant of grants){
        if(grant.fragment!==r.fragment||!await this.referenceMatches(tx,r.fragment,grant,r)||r.fields.some(name=>!grant.fields.includes(name)))continue;
        if(this.connections){if(!grant.connection)continue;try{if(await this.connections.check(grant.connection,grant.clientId)!==true)continue;}catch{continue;}}
        const resources={},methods={};let covered=true;
        for(const name of r.fields){
          const field=r.schema.fields[name];if(!Object.hasOwn(preferences.values,name)&&(field.cardinality?.min??1)>0){covered=false;break;}if(field.type!=='resource')continue;
          const assigned=Object.hasOwn(preferences.values,name)?assignedRefs(field,preferences.values[name]):[],ids=(own(grant.resources,name)??[]).filter(id=>assigned.includes(id)),wanted=own(r.methods,name)??{};
          if(ids.length<(field.cardinality?.min??1)||Object.entries(wanted).some(([contract,list])=>list.some(method=>!own(grant.methods,name)?.[contract]?.includes(method)))){covered=false;break;}
          // A resource reconnected (new generation) or rescoped since the grant made that grant inert; it needs a new review.
          for(const id of ids){const resource=await tx.get(key('resource',id)),value=asList(field,preferences.values[name]).find(item=>reference(item)===id);if(!resource||resource.owner!==subject||(grant.resourceGenerations?.[id]??null)!==(resource.generation??null)||canonical(normalizeScope(grant.resourceScopes?.[name]?.[id]??{}))!==canonical(scope(value))||Object.entries(wanted).some(([contract,list])=>list.some(method=>!resource.contracts[contract]?.includes(method)))){covered=false;break;}}
          if(!covered)break;resources[name]=ids;methods[name]=copy(wanted);
        }
        if(covered&&this.artefactVersions&&canonical(grant.contract_versions??{})!==canonical(r.contract_versions??{}))continue;
        if(covered&&this.artefactVersions&&r.version&&(grant.version??1)<r.version){
          // Resource upgrades wait for contract/payload delta review; scalar-only additive fields cannot widen this set.
          if(Object.keys(r.methods??{}).length||Object.keys(grant.methods??{}).length)continue;const prior=await tx.get(key('schema-version',`${r.fragment}|${grant.digest}`));if(!prior||grant.fields.some(name=>canonical(prior.schema.fields[name])!==canonical(r.schema.fields[name])))continue;
          grant.pinHistory=[...(grant.pinHistory??[]),{at:this.clock(),from:{version:grant.version??1,digest:grant.digest},to:{version:r.version,digest:r.digest}}].slice(-32);grant.version=r.version;grant.digest=r.digest;await tx.set(key('grant',grant.id),grant);
        }
        if(covered){found={fragment:r.fragment,fields:[...r.fields],revision:preferences.revision,resources,methods};break;}
      }
      if(!found)return null;approved.push(found);
    }
    return approved;
  }
  /** The owner step of a pre-owner request: it now spends this owner's budget (OWNER_REQUESTS, anonymous rows excluded). */
  async bindOwner(tx,request){if(!request.anonymous)return request;await this.bounded(tx,'request',OWNER_REQUESTS,{count:row=>!row.anonymous});delete request.anonymous;await tx.set(key('request',request.requestId),request);return request;}
  async pending(tx,id){const request=await tx.get(key('request',id));if(!request||request.status!=='pending'||request.expiresAt<=this.clock())fail('invalid_request','Authorization request expired or completed.');return request;}
  async guardLogin(subject,requestId){if(!this.incremental)return;const request=await this.store.transaction(tx=>this.pending(tx,requestId));if(request.entry||!request.requests.length)return;const entryHash=await digest(this.crypto,`legacy-login\0${requestId}`),client=this.requestClient(request),login=await this.incremental.loginDelta({entryHash,subject,clientId:request.clientId,client,requests:request.requests});if(!login.first)await this.store.transaction(async tx=>{const current=await this.pending(tx,requestId);current.requests=login.requests;await tx.set(key('request',requestId),current);});}
  async inspect(requestId,authority){let binding;if(authority!==undefined){const subject=await this.owner(authority);await this.guardLogin(subject,requestId);if(this.connections){const pending=await this.store.transaction(tx=>this.pending(tx,requestId));binding=await this.connections.binding(pending.clientId);}await this.syncResources(subject);}return this.store.transaction(async tx=>{const request=await this.pending(tx,requestId);const subject=authority===undefined?null:await this.owner(authority,tx);if(subject)await this.bindOwner(tx,request);if(subject&&this.connections){request.connectionBinding=binding;request.connectionReviewed=true;await tx.set(key('request',requestId),request);}const identity=subject?await this.authenticateOwner(authority):null;const requests=[];for(const r of request.requests){let preferences=null,resources=[],affectedApps=[],consumerDigest;if(subject){preferences=await tx.get(key('preferences',`${subject}|${r.fragment}`));resources=(await tx.list(key('resource',''))).map(x=>x.value).filter(x=>x.owner===subject).map(({id,label,contracts,provider,scoping,preview,broker})=>({id,label,contracts,provider,...broker?{brokerOrigin:broker.origin}:{},...scoping?{scoping}:{},...preview?{preview}:{} }));const snapshot=await this.consumerSnapshot(tx,subject,r.fragment,identity.epoch);affectedApps=snapshot.consumers;consumerDigest=snapshot.digest;}requests.push({...r,values:preferences?.values??{},revision:preferences?.revision,resources,affectedApps,consumerDigest});}return {requestId,issuer:this.issuer,client:copy(this.requestClient(request)),requests,authenticated:!!subject,expiresAt:request.expiresAt};});}
  async registerResource(authority,resource){exact(resource,['id','label','contracts','provider','alias','limits','scoping','preview']);this.url(resource.id);if(!boundedString(resource.label,200)||!object(resource.contracts))fail('invalid_resource');for(const [contract,methods]of Object.entries(resource.contracts)){https(contract);strings(methods,32);}if(resource.alias!==undefined&&!['@profile'].includes(resource.alias))fail('invalid_resource');if(resource.provider!==undefined&&!boundedString(resource.provider,200))fail('invalid_resource');return this.store.transaction(async tx=>{const owner=await this.owner(authority,tx);const old=await tx.get(key('resource',resource.id));if(old&&old.owner!==owner)fail('forbidden');await tx.set(key('resource',resource.id),{...copy(resource),owner});return {id:resource.id};});}
  async consumerSnapshot(tx,subject,fragment,epoch){
    const preferences=await tx.get(key('preferences',`${subject}|${fragment}`));
    const schema=(await this.schemaRecord(tx,fragment))?.schema;
    const consumers=[];
    if(preferences&&schema)for(const {value:grant} of await tx.list(key('grant',''))){
      if(!grant.active||grant.subject!==subject||grant.fragment!==fragment||!await this.referenceMatches(tx,fragment,grant,preferences)||grant.epoch!==epoch||!this.clients.has(grant.clientId))continue;
      if(this.connections){if(!grant.connection)continue;try{if(await this.connections.check(grant.connection,grant.clientId)!==true)continue;}catch(error){if(error.code==='invalid_token'||error.code==='unauthorized')continue;throw error;}}
      const fields=[];
      for(const field of grant.fields){
        if(!Object.hasOwn(preferences.values,field))continue;
        if(schema.fields[field].type!=='resource'){fields.push(field);continue;}
        let effective=false;
        for(const id of own(grant.resources,field)??[]){
          const value=asList(schema.fields[field],preferences.values[field]).find(value=>reference(value)===id),resource=await tx.get(key('resource',id));
          if(!value||!resource||resource.owner!==subject||(grant.resourceGenerations?.[id]??null)!==(resource.generation??null)||canonical(normalizeScope(grant.resourceScopes?.[field]?.[id]??{}))!==canonical(scope(value)))continue;
          if(Object.entries(own(grant.methods,field)??{}).some(([contract,methods])=>methods.some(method=>resource.contracts[contract]?.includes(method))))effective=true;
        }
        if(effective)fields.push(field);
      }
      if(fields.length)consumers.push({id:grant.id,client:grant.clientId,name:this.clients.get(grant.clientId).name,fields,methods:copy(grant.methods),resources:copy(grant.resources),resourceScopes:copy(grant.resourceScopes??{}),resourceGenerations:copy(grant.resourceGenerations??{}),connection:copy(grant.connection??null)});
    }
    consumers.sort((a,b)=>a.id.localeCompare(b.id));
    return {consumers,digest:await digest(this.crypto,canonical({fragment,revision:preferences?.revision??null,epoch:epoch??null,consumers}))};
  }
  async preferences(authority){
    const identity=await this.authenticateOwner(authority);const subject=await this.owner(authority);await this.syncResources(subject);
    return this.store.transaction(async tx=>{
      const preferences=[];const resources=(await tx.list(key('resource',''))).map(row=>row.value).filter(resource=>resource.owner===subject).map(({id,label,contracts,provider,scoping,preview,broker})=>({id,label,contracts,provider,...broker?{brokerOrigin:broker.origin}:{},...scoping?{scoping}:{},...preview?{preview}:{}}));
      for(const {value}of await tx.list(key('preferences',`${subject}|`))){const schema=(await this.schemaRecord(tx,value.fragment))?.schema;if(!schema)continue;const snapshot=await this.consumerSnapshot(tx,subject,value.fragment,identity.epoch);preferences.push({fragment:value.fragment,schema,values:copy(value.values),revision:value.revision,consumerDigest:snapshot.digest,affectedApps:snapshot.consumers,resources});}
      return {preferences};
    });
  }
  async queueBrokeredInvalidation(tx,match){
    if(!this.brokering)return;const now=this.clock();
    for(const row of await tx.list(key('brokered-jti',''))){const value=row.value;if(value.expiresAt<=now||value.invalidated||!match(value))continue;value.invalidated=true;await tx.set(row.key,value);if(value.connection&&value.grant){const source=this.random();await tx.set(key('brokered-event',source),{source,event:{type:'credential-revoked',connection:value.connection,grants:[value.grant],until:Math.floor((now+360000)/1000)}});}}
  }
  async drainBrokeredEvents(){
    if(typeof this.brokering?.event!=='function')return {pending:false};const rows=await this.store.transaction(tx=>tx.list(key('brokered-event','')));
    for(const row of rows.slice(0,128)){try{await this.brokering.event(row.value);await this.store.transaction(tx=>tx.delete(row.key));}catch{return {pending:true};}}return {pending:rows.length>128};
  }
  async configure(authority,input){
    exact(input,['fragment','values','expectedRevision','reviewedConsumerDigest','updateShared',...this.artefactVersions?['version','digest']:[]]);const {fragment,values,expectedRevision,reviewedConsumerDigest,updateShared}=input;
    if(updateShared!==undefined&&typeof updateShared!=='boolean')fail('invalid_args');if(this.resourceProvider&&!Object.hasOwn(input,'expectedRevision'))fail('stale_consent','Review the current preferences before saving.');
    const identity=await this.authenticateOwner(authority),subject=await this.owner(authority);if(subject!==identity.subject)fail('unauthorized');await this.syncResources(subject);
    const pinned=await this.schema(this.artefactVersions&&(input.version!==undefined||input.digest!==undefined)?{fragment,...input.version!==undefined?{version:input.version}:{},...input.digest!==undefined?{digest:input.digest}:{}}:fragment);if(!object(values)||Object.keys(values).some(name=>!Object.hasOwn(pinned.schema.fields,name)))fail('invalid_preferences');
    return this.store.transaction(async tx=>{
      await this.active(subject,identity.epoch);const old=await tx.get(key('preferences',`${subject}|${fragment}`));if(this.artefactVersions&&old?.version&&(!pinned.version||pinned.version<old.version))fail('stale_consent','Review the current fragment version before saving.');
      if(Object.hasOwn(input,'expectedRevision')&&(old?.revision??null)!==expectedRevision)fail('stale_consent','This preference changed. Review the latest values.');
      for(const [name,field] of Object.entries(pinned.schema.fields)){
        if(!Object.hasOwn(values,name)){if((field.cardinality?.min??1)>0)fail('invalid_preferences','Required field missing.');continue;}
        const list=validateValue(field,values[name],value=>this.url(value));
        if(field.type==='resource')for(const value of list){
          const id=reference(value),resource=await tx.get(key('resource',id));
          if(!resource||resource.owner!==subject||field.contracts.some(contract=>!resource.contracts[contract]))fail('invalid_resource');
          if(object(value)){if(!resource.scoping?.fields)fail('invalid_preferences','This resource does not support scoped assignments.');for(const [name,setting]of Object.entries(value.scope)){const option=resource.scoping.fields[name];if(!option||name==='maxObjectBytes'&&setting>option.maximum||name==='prefix'&&setting.length>option.maxLength)fail('invalid_preferences','Scope is outside the resource constraints.');}}
        }
      }
      let reviewed=new Map();
      if(updateShared){if(!Object.hasOwn(input,'expectedRevision')||!boundedString(reviewedConsumerDigest,128))fail('stale_consent','Review the consumers before updating shared access.');const snapshot=await this.consumerSnapshot(tx,subject,fragment,identity.epoch);if(snapshot.digest!==reviewedConsumerDigest)fail('stale_consent','The consumers changed. Review shared access again.');reviewed=new Map(snapshot.consumers.map(consumer=>[consumer.id,consumer]));}
      for(const {key:grantKey,value:grant} of await tx.list(key('grant',''))){
        if(grant.subject!==subject||grant.fragment!==fragment)continue;
        for(const [field,approved]of Object.entries(grant.resources)){
          const assigned=Object.hasOwn(values,field)?assignedRefs(pinned.schema.fields[field],values[field]):[];
          const assignmentChanged=canonical(assignmentAuthority(pinned.schema.fields[field],old?.values,field))!==canonical(assignmentAuthority(pinned.schema.fields[field],values,field));
          if(updateShared&&assignmentChanged&&reviewed.get(grant.id)?.fields.includes(field)){
            // Only fields this consumer still effectively held are updated.
            // Its method set is preserved verbatim; no revoked field revives.
            grant.resources[field]=assigned;grant.approvedResources??={};grant.assignedResources??={};grant.resourceScopes??={};grant.resourceGenerations??={};
            grant.approvedResources[field]=copy(assigned);grant.assignedResources[field]=copy(assigned);
            grant.resourceScopes[field]=Object.fromEntries(assigned.map(id=>[id,scope(asList(pinned.schema.fields[field],values[field]).find(value=>reference(value)===id))]));
            for(const id of assigned)grant.resourceGenerations[id]=(await tx.get(key('resource',id))).generation??null;
          }else grant.resources[field]=approved.filter(id=>assigned.includes(id)&&canonical(normalizeScope(grant.resourceScopes?.[field]?.[id]??{}))===canonical(scope(asList(pinned.schema.fields[field],values[field]).find(value=>reference(value)===id))));
        }
        const retained=new Set(Object.values(grant.resources).flat());grant.resourceGenerations=Object.fromEntries(Object.entries(grant.resourceGenerations??{}).filter(([id])=>retained.has(id)));for(const [field,ids]of Object.entries(grant.resources))if(grant.resourceScopes?.[field])grant.resourceScopes[field]=Object.fromEntries(Object.entries(grant.resourceScopes[field]).filter(([id])=>ids.includes(id)));
        await tx.set(grantKey,grant);
      }
      // X8-R2: only a changed field ends its brokered tokens; an unrelated edit (a theme) must not sever them for 360 s.
      {const changed=new Set(Object.keys({...old?.values,...values}).filter(n=>canonical(old?.values?.[n]??null)!==canonical(values[n]??null)));if(changed.size)await this.queueBrokeredInvalidation(tx,v=>v.fragment===fragment&&changed.has(v.field));}
      const revision=this.random(),resourceRevisions={},committedValues=copy(values);
      for(const [name,field]of Object.entries(pinned.schema.fields))if(field.type==='resource'&&Object.hasOwn(committedValues,name)){const normalized=asList(field,committedValues[name]).map(value=>object(value)?{resource:reference(value),scope:scope(value)}:value);committedValues[name]=(field.cardinality?.max??1)===1?normalized[0]:normalized;}
      for(const [name,field]of Object.entries(pinned.schema.fields))if(field.type==='resource'&&Object.hasOwn(values,name)){resourceRevisions[name]=own(old?.resourceRevisions,name)&&canonical(assignmentAuthority(field,old.values,name))===canonical(assignmentAuthority(field,values,name))?own(old.resourceRevisions,name):base64url(this.crypto.getRandomValues(new Uint8Array(32)));}
      await tx.set(key('preferences',`${subject}|${fragment}`),{fragment,digest:pinned.digest,...pinned.version?{version:pinned.version}:{},values:committedValues,revision,resourceRevisions});
      return {fragment,revision};
    });
  }
  async approve(authority,input,options={}){let adopted,issuedCodeKey,approvedRequest,notificationConsent=false,claim;const identity=await this.authenticateOwner(authority);await this.syncResources(identity.subject);await this.guardLogin(identity.subject,input.requestId);exact(input,['requestId','approved','denied']);if(input.denied!==undefined&&input.denied!==true)fail('invalid_args');if(!input.denied&&!Array.isArray(input.approved))fail('invalid_args');const response=await this.store.transaction(async tx=>{const subject=await this.owner(authority,tx);const currentIdentity=await this.authenticateOwner(authority);if(currentIdentity.subject!==identity.subject||currentIdentity.epoch!==identity.epoch)fail('stale_consent');const request=await this.bindOwner(tx,await this.pending(tx,input.requestId));if(!!request.entry!==(options?.entry===true))fail('invalid_request','Continue from the provider sign-in page.');if(input.denied){request.status='denied';await tx.set(key('request',input.requestId),request);return {redirectUri:this.redirect(request,{error:'access_denied'})};}
    const reauthenticated=request.entry?.intent==='reauthenticate';if(reauthenticated&&(subject!==request.entry.subjectConstraint||!reauthenticationFresh(identity.authTime,request.entry,this.clock())))fail('reauthentication_required','Sign in again to confirm this account.');
    if(input.approved.length>request.requests.length||new Set(input.approved.map(a=>a.fragment)).size!==input.approved.length)fail('invalid_grant');const grants=[];
    for(const selection of input.approved){exact(selection,['fragment','fields','resources','methods','revision']);const wanted=request.requests.find(r=>r.fragment===selection.fragment);if(!wanted)fail('invalid_grant');strings(selection.fields,32);if(!selection.fields.length||selection.fields.some(name=>!wanted.fields.includes(name))||wanted.required&&wanted.fields.some(name=>!selection.fields.includes(name)))fail('invalid_grant');const preferences=await tx.get(key('preferences',`${subject}|${selection.fragment}`));if(!preferences||!await this.referenceMatches(tx,selection.fragment,wanted,preferences)||selection.revision!==preferences.revision)fail('stale_consent','Review the current preference values before approval.');const resources=Object.assign(Object.create(null),selection.resources??{}),methods=Object.assign(Object.create(null),selection.methods??{});if(!object(resources)||!object(methods)||Object.keys(resources).some(n=>!selection.fields.includes(n))||Object.keys(methods).some(n=>!selection.fields.includes(n)))fail('invalid_grant');
      for(const name of selection.fields){const field=wanted.schema.fields[name];if(!Object.hasOwn(preferences.values,name)&&(field.cardinality?.min??1)>0)fail('invalid_preferences');if(field.type!=='resource'){if(resources[name]!==undefined||methods[name]!==undefined)fail('invalid_grant');continue;}resources[name]??=[];methods[name]??={};strings(resources[name],16);const assigned=Object.hasOwn(preferences.values,name)?assignedRefs(field,preferences.values[name]):[];if((resources[name]??[]).length<(field.cardinality?.min??1)||resources[name].some(id=>!assigned.includes(id)))fail('invalid_grant');if(!object(methods[name]??{}))fail('invalid_grant');for(const[contract,allowed]of Object.entries(methods[name]??{})){strings(allowed,32);if(!allowed.length||allowed.some(m=>!wanted.methods[name]?.[contract]?.includes(m)))fail('invalid_grant');for(const id of resources[name]){const resource=await tx.get(key('resource',id));if(!resource||resource.owner!==subject||allowed.some(m=>!resource.contracts[contract]?.includes(m)))fail('invalid_grant');}}}
      await this.bounded(tx,'grant',256);const id=this.random(),grant={id,subject,clientId:request.clientId,fragment:selection.fragment,digest:wanted.digest,...this.artefactVersions&&wanted.contract_versions?{contract_versions:copy(wanted.contract_versions)}:{},...wanted.version?{version:wanted.version}:{},fields:copy(selection.fields),resources:copy(resources),methods:copy(methods),active:true,epoch:identity.epoch,assignedResources:Object.fromEntries(selection.fields.filter(name=>wanted.schema.fields[name].type==='resource').map(name=>[name,Object.hasOwn(preferences.values,name)?assignedRefs(wanted.schema.fields[name],preferences.values[name]):[]])),approvedResources:copy(resources),resourceScopes:Object.fromEntries(Object.entries(resources).map(([field,ids])=>[field,Object.fromEntries(ids.map(id=>[id,scope(asList(wanted.schema.fields[field],preferences.values[field]).find(value=>reference(value)===id))]))])),resourceGenerations:Object.fromEntries(await Promise.all(Object.values(resources).flat().map(async id=>[id,(await tx.get(key('resource',id)))?.generation??null]))),approvedAt:this.clock()};await tx.set(key('grant',id),grant);grants.push(id);notificationConsent||=Object.entries(methods).some(([field,contracts])=>hasAdmissionMethod({[field]:contracts})&&resources[field]?.length);
    }
    if(request.requests.some(r=>r.required&&!input.approved.some(a=>a.fragment===r.fragment)))fail('consent_required','Declining a required fragment cancels this connection.');
    await this.bounded(tx,'code',64,{count:row=>row.used!==true});const code=this.random(),codeHash=await digest(this.crypto,`code\0${code}`);issuedCodeKey=key('code',codeHash);approvedRequest=request;
    // Only an attested embed entry approved through the entry route pairs a claim with its code.
    let claimHash;if(options?.claim===true&&request.entry?.delivery==='embed-popup'&&request.entry.embedJkt)({claim,claimHash}=await mintClaim(this,tx,{codeHash,subject,epoch:identity.epoch,clientId:request.clientId,embedJkt:request.entry.embedJkt}));
    await this.persistClient(tx,request);if(request.client&&!this.staticClients.has(request.clientId))adopted=request;await tx.set(issuedCodeKey,{approvedFrom:identity.sessionId??null,approvalChain:identity.approvalChain??[],authTime:Number.isSafeInteger(identity.authTime)?identity.authTime:null,subject,epoch:identity.epoch,clientId:request.clientId,redirectUri:request.redirectUri,challenge:request.challenge,grants,expiresAt:this.clock()+60000,...request.entry?{intent:request.entry.intent,...request.entry.dpopJkt?{dpopJkt:request.entry.dpopJkt}:{},...reauthenticated?{authTime:identity.authTime}:{},...claimHash?{claimHash}:{}}:{}});request.status='approved';await tx.set(key('request',request.requestId),request);return {redirectUri:this.redirect(request,{code}),...claim?{claim}:{}};
  });if(adopted)this.clients.set(adopted.clientId,copy(adopted.client));if(issuedCodeKey&&this.connections){try{if(!approvedRequest.connectionReviewed)fail('stale_consent','Review this application connection before approval.');const connection=await this.connections.connect(this.requestClient(approvedRequest),approvedRequest.connectionBinding,{notifications:notificationConsent});await this.active(identity.subject,identity.epoch);await this.store.transaction(async tx=>{const record=await tx.get(issuedCodeKey);if(!record)fail('invalid_grant');record.connection=connection;await tx.set(issuedCodeKey,record);for(const id of record.grants){const grant=await tx.get(key('grant',id));if(grant){grant.connection=copy(connection);await tx.set(key('grant',id),grant);}}});}catch(error){await this.store.transaction(async tx=>{const record=await tx.get(issuedCodeKey);for(const id of record?.grants??[])await tx.delete(key('grant',id));if(record?.claimHash)await tx.delete(key('claim',record.claimHash));await tx.delete(issuedCodeKey);const request=await tx.get(key('request',input.requestId));if(request?.status==='approved'){request.status='pending';request.connectionReviewed=false;await tx.set(key('request',input.requestId),request);}});throw error;}}await syncEventReaders(this,identity.subject);if(this.incremental)try{await this.incremental.loginOutcome({entryHash:await digest(this.crypto,`legacy-login\0${input.requestId}`),subject:identity.subject,approved:input.denied?null:input.approved});}catch{}return response;}
  redirect(request,params){const url=new URL(request.redirectUri);for(const[k,v]of Object.entries({...params,state:request.state,iss:this.issuer}))url.searchParams.set(k,v);return url.href;}
  async liveGrantIds(tx,authority){
    const grants=[];for(const id of authority.grants){const grant=await tx.get(key('grant',id));if(grant?.active&&grant.subject===authority.subject&&grant.clientId===authority.clientId&&grant.epoch===authority.epoch)grants.push(id);}
    if(authority.grants.length&&!grants.length)fail('unauthorized','This application authorization was revoked.');return grants;
  }
  async issueAccess(tx,authority){
    return issueAppAccess(this,tx,{...authority,expiresAt:authority.expiresAt??Infinity});
  }
  async pruneRefreshFamilies(tx,current){
    let live=0;const removed=new Set();
    for(const {key:familyKey,value:family}of await tx.list(key('family',''))){
      if(family.subject!==current.subject)continue;
      let invalid=family.status!=='active'||family.expiresAt<=this.clock()||(family.idleExpiresAt??Infinity)<=this.clock()||family.epoch!==current.epoch||!this.clients.has(family.clientId);
      if(!invalid&&this.connections){try{invalid=!family.connection||await this.connections.check(family.connection,family.clientId)!==true;}catch(error){if(['invalid_token','unauthorized'].includes(error.code))invalid=true;else throw error;}}
      if(!invalid){try{await this.liveGrantIds(tx,family);}catch(error){if(error.code==='unauthorized')invalid=true;else throw error;}}
      if(invalid){for(const hash of family.history??[])await tx.delete(key('refresh',hash));await tx.delete(familyKey);removed.add(family.familyId);}else live++;
    }
    if(removed.size)for(const row of await tx.list(key('token','')))if(removed.has(row.value.familyId))await tx.delete(row.key);
    if(live>=32)fail('rate_limited','This account has reached its application session limit. Disconnect an unused app or wait for a session to expire.');
  }
  async createRefreshFamily(tx,authority){
    return createAppSession(this,tx,authority);
  }
  async exchange(input){
    exact(input,['code','verifier','clientId','redirectUri','dpop']);this.client(input.clientId,input.redirectUri);
    if(!this.opaque(input.code)||typeof input.verifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier))fail('invalid_grant');
    const hash=await digest(this.crypto,`code\0${input.code}`),challenge=await digest(this.crypto,input.verifier),proof=input.dpop===undefined?null:await this.tokenProof(input.dpop);
    const result=await this.store.transaction(async tx=>{
      const code=await tx.get(key('code',hash));
      // RFC 9700 §4.5 / RFC 6749 §4.1.2 (wargame 2026-10-23): a redeemed code leaves a tombstone until its replay window
      // ends; a replay revokes what the first redemption issued (its client session, or its lone access token).
      if(code?.used===true){if(code.expiresAt>this.clock()&&!code.revoked){if(code.familyId){const family=await tx.get(key('family',code.familyId));if(family&&family.status==='active')await revokeFamily(this,tx,family);}for(const row of await tx.list(key('token','')))if(row.value.codeHash===hash)await tx.delete(row.key);code.revoked=true;await tx.set(key('code',hash),code);}return {failure:'invalid_grant'};}
      if(!code||code.expiresAt<=this.clock()||code.clientId!==input.clientId||code.redirectUri!==input.redirectUri||code.challenge!==challenge)fail('invalid_grant');
      // A key named by the entry must be proven; an unpinned key cannot bind the session.
      if((code.dpopJkt??null)!==(proof?.jkt??null))fail('invalid_dpop_proof','The DPoP proof does not match this authorization.');if(proof)await this.consumeProof(tx,proof);
      await this.active(code.subject,code.epoch);if(this.connections&&(!code.connection||await this.connections.check(code.connection,code.clientId)!==true))fail('unauthorized');
      const authority={subject:code.subject,epoch:code.epoch,clientId:code.clientId,grants:copy(code.grants),approvedFrom:code.approvedFrom??null,approvalChain:code.approvalChain??[],authTime:code.authTime??null,...code.connection?{connection:copy(code.connection)}:{}};
      let refresh;if(this.refreshEnabled)refresh=code.dpopJkt?await createAppSession(this,tx,authority,code.dpopJkt,{...proof?.jwk?{jwk:proof.jwk}:{}}):await this.createRefreshFamily(tx,authority);
      const response=await this.issueAccess(tx,refresh?.family??{...authority,codeHash:hash});await tx.set(key('code',hash),{used:true,clientId:code.clientId,subject:code.subject,...refresh?.family?.familyId?{familyId:refresh.family.familyId}:{},expiresAt:this.clock()+CODE_REPLAY_WINDOW_MS});await linkExchange(this,tx,code,refresh?.family);
      return {...response,...refresh?{refresh_token:refresh.refresh_token,refresh_expires_in:refresh.refresh_expires_in,...refresh.refresh_idle_expires_in!==undefined?{refresh_idle_expires_in:refresh.refresh_idle_expires_in}:{}}:{},...code.intent==='reauthenticate'&&Number.isSafeInteger(code.authTime)?{auth_time:Math.floor(code.authTime/1000)}:{}};
    });
    if(result?.failure)fail(result.failure);return result;
  }
  async refresh(input){
    if(!this.refreshEnabled)fail('unsupported_grant_type','Refresh tokens are not enabled.');
    exact(input,['refreshToken','clientId','dpop']);if(!this.clients.has(input.clientId))fail('invalid_client');if(!this.opaque(input.refreshToken))fail('invalid_grant');
    const hash=await digest(this.crypto,`refresh\0${input.refreshToken}`),proof=input.dpop===undefined?null:await this.tokenProof(input.dpop);
    const result=await this.store.transaction(async tx=>{
      const record=await tx.get(key('refresh',hash)),family=record&&await tx.get(key('family',record.familyId));
      // A foreign client cannot revoke a valid session by presenting its secret.
      if(!family||family.clientId!==input.clientId||family.issuer!==this.issuer||family.audience!==this.audience||family.expiresAt<=this.clock()||record.expiresAt!==family.expiresAt||family.status!=='active')fail('invalid_grant');
      if(family.jkt){if(proof?.jkt===family.jkt)await this.consumeProof(tx,proof);return rotateBound(this,tx,{record,family,hash,token:input.refreshToken,proof});}
      if(record.used||family.currentHash!==hash||!Array.isArray(family.history)||(family.idleExpiresAt??Infinity)<=this.clock()){await revokeFamily(this,tx,family);return {failure:'invalid_grant'};}
      await this.active(family.subject,family.epoch);if(this.connections&&(!family.connection||await this.connections.check(family.connection,family.clientId)!==true))fail('unauthorized');
      const response=await this.issueAccess(tx,family),refresh_token=this.random(),nextHash=await digest(this.crypto,`refresh\0${refresh_token}`);
      record.used=true;await tx.set(key('refresh',hash),record);family.history.push(nextHash);family.currentHash=nextHash;family.lastUsedAt=this.clock();family.idleExpiresAt=Math.min(family.expiresAt,this.clock()+appRefreshIdleMs(this));while(family.history.length>APP_SESSION.history)await tx.delete(key('refresh',family.history.shift()));await tx.set(key('family',family.familyId),family);await tx.set(key('refresh',nextHash),{familyId:family.familyId,used:false,expiresAt:family.expiresAt});
      return {...response,refresh_token,...expiresIn(family,this.clock())};
    });
    // Commit reuse revocation before raising a fault; throwing inside the
    // transaction would roll back the family revocation.
    if(result.failure)fail(result.failure,'This application session must sign in again.');return result;
  }
  async cleanup({limit=128}={}){
    if(!Number.isSafeInteger(limit)||limit<1||limit>256)fail('invalid_args');
    return this.store.transaction(async tx=>{
      let removed=0,remaining=false,nextAlarmAt=Infinity;const now=this.clock();
      for(const kind of ['request','code','token','journal','incremental-decision','refresh','family','object-url','url-mint','claim','embed','embed-session','embed-stream','dpop','assertion-jti'])for(const row of await tx.list(key(kind,''))){
        const linked=['refresh','token','embed','embed-session'].includes(kind)&&!!row.value.familyId,family=linked?await tx.get(key('family',row.value.familyId)):null;
        const deadline=Math.min(row.value.expiresAt,row.value.idleExpiresAt??Infinity,family?Math.min(family.expiresAt,family.idleExpiresAt??Infinity):Infinity);
        const expired=deadline<=now||kind==='request'&&row.value.status!=='pending'||kind==='family'&&row.value.status!=='active'||linked&&(!family||family.status!=='active');
        if(expired&&removed<limit){await tx.delete(row.key);removed++;continue;}
        remaining=true;nextAlarmAt=Math.min(nextAlarmAt,expired?now+60000:deadline);
      }
      return {removed,remaining,nextAlarmAt:remaining?Math.max(now+60000,nextAlarmAt):null};
    });
  }
  async tokenProof(dpop){if(!this.dpopNonces)fail('invalid_dpop_proof','DPoP is not configured.');return verifyProof(this.crypto,dpop,{typ:DPOP_TYP,htm:'POST',htu:`${this.issuer}/oauth/token`,now:this.clock(),nonce:value=>this.dpopNonces.check('token',value)});}
  async embedProof(dpop,purpose,ath,htm='POST'){if(!this.dpopNonces||!this.embedOrigin)fail('unauthorized','The embedded session is unavailable.');try{return await verifyProof(this.crypto,dpop,{typ:DPOP_TYP,htm,htu:`${this.embedOrigin}/embed/api/${purpose}`,now:this.clock(),ath,nonce:value=>this.dpopNonces.check('embed',value)});}catch{fail('unauthorized','The embedded session is unavailable.');}}
  consumeProof(tx,proof){return consumeProof(tx,key('dpop',''),proof,this.crypto,this.clock);}
  revokeToken(input){return revokeToken(this,input);}
  redeemClaim(input){return redeemClaim(this,input);}
  embedSession(input){return startSession(this,input);}
  embedState(input){return sessionState(this,input);}
  embedForget(input){return forget(this,input);}
  embedAvatar(input){return sessionAvatar(this,input);}
  embedEvents(input){return openStream(this,input);}
  embedEventsTick(input){return streamTick(this,input);}
  embedEnd(input){return endSession(this,input);}
  inspectObjectURL(input){if(!this.objectURLService)fail('temporarily_unavailable');return this.objectURLService.inspect(input);}
  async objectURL(input){if(!this.objectURLService)fail('temporarily_unavailable');const claims=await this.objectURLService.claims(input);if(claims.operation==='write'){await this.objectURLService.inspect(claims);await this.termsAllowed?.(`${this.issuer}/entities/${claims.owner}`);}return this.objectURLService.execute(input);}
  async grants(authority){const subject=await this.owner(authority);return this.store.transaction(async tx=>({grants:(await tx.list(key('grant',''))).map(row=>row.value).filter(grant=>grant.subject===subject&&grant.active).map(({epoch,resourceGenerations,...grant})=>({...grant,client:copy(this.clients.get(grant.clientId))}))}));}
  async revoke(authority,id){const result=await this.store.transaction(async tx=>{const subject=await this.owner(authority,tx),grant=await tx.get(key('grant',id));if(!grant||grant.subject!==subject)fail('not_found');grant.active=false;await this.queueBrokeredInvalidation(tx,v=>v.grants?.includes(id));await tx.set(key('grant',id),grant);return {revoked:true};});await syncEventReaders(this,await this.owner(authority));return result;}
  async token(tx,bearer){if(!this.opaque(bearer))fail('unauthorized');return this.tokenRecord(tx,await tx.get(key('token',await digest(this.crypto,`token\0${bearer}`))));}
  async tokenRecord(tx,token){if(!token||!this.clients.has(token.clientId)||token.issuer!==this.issuer||token.audience!==this.audience||token.expiresAt<=this.clock())fail('unauthorized');if(token.familyId){const family=await tx.get(key('family',token.familyId));if(!family||family.status!=='active'||family.expiresAt<=this.clock()||(family.idleExpiresAt??Infinity)<=this.clock()||family.subject!==token.subject||family.clientId!==token.clientId||family.epoch!==token.epoch||family.issuer!==this.issuer||family.audience!==this.audience||(family.connection?.id??null)!==(token.connection?.id??null)||(family.connection?.generation??null)!==(token.connection?.generation??null)||token.grants.some(id=>!family.grants.includes(id)))fail('unauthorized');if(!await lineageLive(this,family))fail('unauthorized');if((family.lastUsedAt??0)+60000<=this.clock()){family.lastUsedAt=this.clock();await tx.set(key('family',family.familyId),family);}}if(token.attenuation&&(typeof token.attenuation.assignmentRevision!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token.attenuation.assignmentRevision)))fail('unauthorized');await this.active(token.subject,token.epoch);if(this.connections&&(!token.connection||await this.connections.check(token.connection,token.clientId)!==true))fail('unauthorized');const grants=[];for(const id of token.grants){const grant=await tx.get(key('grant',id));if(grant?.active&&grant.subject===token.subject&&grant.clientId===token.clientId)grants.push(grant);}if(!grants.length&&token.grants.length)fail('unauthorized');return {token,grants};}
  async readPreferences(tx,token,grants,args,bearer){exact(args,['fragment']);const relevant=grants.filter(g=>g.fragment===args.fragment);if(!relevant.length)fail('forbidden');const preferences=await tx.get(key('preferences',`${token.subject}|${args.fragment}`));if(!preferences||!(await Promise.all(relevant.map(g=>this.referenceMatches(tx,args.fragment,g,preferences)))).every(Boolean))fail('forbidden');const schema=(await this.schemaRecord(tx,args.fragment)).schema,values={},requiresConsent=[];
    for(const name of new Set(relevant.flatMap(g=>g.fields))){if(!Object.hasOwn(preferences.values,name))continue;const field=schema.fields[name],value=preferences.values[name];if(field.type!=='resource'){values[name]=copy(value);continue;}const assigned=asList(field,value),descriptors=[];let missing=false;for(const assignment of assigned){const id=reference(assignment),resource=await tx.get(key('resource',id));if(resource?.provider==='brokered'||resource?.provider==='relation'){missing=true;continue;}const permitted=relevant.filter(g=>own(g.resources,name)?.includes(id)&&(g.resourceGenerations?.[id]??null)===(resource?.generation??null)&&canonical(normalizeScope(g.resourceScopes?.[name]?.[id]??{}))===canonical(scope(assignment)));if(!resource||resource.owner!==token.subject||!permitted.length){const excluded=relevant.every(grant=>own(grant.assignedResources,name)?.includes(id)&&!own(grant.approvedResources,name)?.includes(id));if(!excluded)missing=true;continue;}const contracts=Object.keys(resource.contracts).filter(c=>permitted.some(g=>g.methods[name]?.[c]?.some(method=>resource.contracts[c].includes(method))));if(typeof preferences.resourceRevisions?.[name]!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(preferences.resourceRevisions[name])){preferences.resourceRevisions??={};preferences.resourceRevisions[name]=base64url(this.crypto.getRandomValues(new Uint8Array(32)));await tx.set(key('preferences',`${token.subject}|${args.fragment}`),preferences);}const attenuation={fragment:args.fragment,field:name,resource:id,scope:copy(scope(assignment)),generation:resource.generation??null,assignmentRevision:preferences.resourceRevisions?.[name]??null};attenuation.reference=`${this.issuer}/resources/scoped/${await digest(this.crypto,`bindle-child-reference-v1\0${attenuation.assignmentRevision}\0${canonical({fragment:args.fragment,field:name,resource:id,generation:attenuation.generation,scope:attenuation.scope})}`)}`;const child=`${this.routingKey?this.routingKey+'.':''}${await digest(this.crypto,`bindle-resource-token-v1\0${bearer}\0${Math.floor(this.clock()/appAccessMs(this))}\0${canonical(attenuation)}`)}`;const childKey=key('token',await digest(this.crypto,`token\0${child}`));if(!await tx.get(childKey)){await this.bounded(tx,'token',256);const {jkt,...authority}=copy(token);await tx.set(childKey,{...authority,expiresAt:Math.min(token.expiresAt,this.clock()+appAccessMs(this)),grants:permitted.map(grant=>grant.id),attenuation});}const childRecord=await tx.get(childKey);descriptors.push({id:childRecord.attenuation.reference,contracts,token:child});}if(missing)requiresConsent.push(name);else values[name]=(field.cardinality?.max??1)===1?descriptors[0]:descriptors;}
    return {fragment:args.fragment,revision:preferences.revision,values,...requiresConsent.length?{requiresConsent}:{}};
  }
  /** preferences/v2 projection (integrations §5.1, AMD-C3/C9). Every resource field is a list of uniform references in
   * owner order: approved members are kept, unapproved additions are omitted and the field is listed in
   * `requiresConsent`. Issuer-hosted members carry the same attenuated child token as v1; brokered members come back
   * as `pending` mints (never invoked through this gateway). `issue=false` (the X6 snapshot) creates no token and
   * reports brokered status from the last resource sync. */
  async projectV2(tx,{subject,clientId,grants,fragment,token,bearer,issue}){
    const relevant=grants.filter(g=>g.fragment===fragment);if(!relevant.length)fail('forbidden');
    const preferences=await tx.get(key('preferences',`${subject}|${fragment}`));if(!preferences||!(await Promise.all(relevant.map(g=>this.referenceMatches(tx,fragment,g,preferences)))).every(Boolean))fail('forbidden');
    const schema=(await this.schemaRecord(tx,fragment)).schema,values={},requiresConsent=[],pending=[];
    for(const name of new Set(relevant.flatMap(g=>g.fields))){
      if(!Object.hasOwn(preferences.values,name))continue;const field=schema.fields[name],value=preferences.values[name];if(field.type!=='resource'){values[name]=copy(value);continue;}
      const list=[];let consent=false;
      for(const assignment of asList(field,value)){
        const id=reference(assignment),resource=await tx.get(key('resource',id));
        const permitted=relevant.filter(g=>own(g.resources,name)?.includes(id)&&(g.resourceGenerations?.[id]??null)===(resource?.generation??null)&&canonical(normalizeScope(g.resourceScopes?.[name]?.[id]??{}))===canonical(scope(assignment)));
        if(!resource||resource.owner!==subject||!permitted.length){if(!relevant.every(g=>own(g.assignedResources,name)?.includes(id)&&!own(g.approvedResources,name)?.includes(id)))consent=true;continue;}
        const methods={};for(const c of Object.keys(resource.contracts).sort()){const ms=[...new Set(permitted.flatMap(g=>own(g.methods,name)?.[c]??[]))].filter(m=>resource.contracts[c].includes(m)).sort();if(ms.length)methods[c]=ms;}
        const contracts=Object.keys(methods);let cv;if(resource.provider==='brokered'&&permitted.some(g=>g.contract_versions)){cv={};for(const c of contracts){const refs=permitted.filter(g=>g.methods[name]?.[c]?.length).map(g=>g.contract_versions?.[c]);if(!refs.length||refs.some(r=>!r||canonical(r)!==canonical(refs[0])))fail('consent_required');cv[c]=refs[0];}cv=contractReferences(cv,contracts);}
        if(resource.provider==='relation'){
          // ORG-10d relay form (spec organizations §10): the token is an entity certificate the organization issues after
          // its own hop evaluation (relations.certify); any refusal reports the member `unavailable`, never a reason.
          const entry={id:`${this.issuer}/resources/scoped/${await digest(this.crypto,`bindle-relation-reference-v1\0${clientId}\0${canonical({fragment,field:name,resource:id})}`)}`,label:resource.label,status:'unavailable',contracts,methods,grantor:`${resource.grantor?.iss}/identity/${resource.grantor?.sub}`,instance:resource.instance};
          if(issue&&contracts.length&&resource.available===true&&this.relationImports)pending.push({relation:true,entry,field:name,resource:id,grants:permitted.map(g=>g.id),grantRecords:permitted.map(g=>copy(g))});
          list.push(entry);continue;
        }
        if(resource.provider==='brokered'){
          const broker=object(resource.broker)?resource.broker:{},entry={id:`${this.issuer}/resources/scoped/${await digest(this.crypto,`bindle-brokered-reference-v1\0${clientId}\0${canonical({fragment,field:name,resource:id})}`)}`,label:resource.label,status:!issue&&broker.available===true&&contracts.length?'available':'unavailable',contracts,methods,broker:{endpoint:broker.endpoint,origin:broker.origin,resource:broker.resource}};
          if(issue&&contracts.length&&typeof broker.record==='string')pending.push({entry,record:broker.record,field:name,methods,...cv?{cv}:{}});if(cv)entry.cv=copy(cv);list.push(entry);continue;
        }
        if(typeof preferences.resourceRevisions?.[name]!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(preferences.resourceRevisions[name])){preferences.resourceRevisions??={};preferences.resourceRevisions[name]=base64url(this.crypto.getRandomValues(new Uint8Array(32)));await tx.set(key('preferences',`${subject}|${fragment}`),preferences);}
        const attenuation={fragment,field:name,resource:id,scope:copy(scope(assignment)),generation:resource.generation??null,assignmentRevision:preferences.resourceRevisions[name]};
        attenuation.reference=`${this.issuer}/resources/scoped/${await digest(this.crypto,`bindle-child-reference-v1\0${attenuation.assignmentRevision}\0${canonical({fragment,field:name,resource:id,generation:attenuation.generation,scope:attenuation.scope})}`)}`;
        const entry={id:attenuation.reference,label:resource.label,status:contracts.length?'available':'unavailable',contracts};
        if(issue){const child=`${this.routingKey?this.routingKey+'.':''}${await digest(this.crypto,`bindle-resource-token-v1\0${bearer}\0${Math.floor(this.clock()/appAccessMs(this))}\0${canonical(attenuation)}`)}`,childKey=key('token',await digest(this.crypto,`token\0${child}`));
          if(!await tx.get(childKey)){await this.bounded(tx,'token',256);const {jkt,...authority}=copy(token);await tx.set(childKey,{...authority,expiresAt:Math.min(token.expiresAt,this.clock()+appAccessMs(this)),grants:permitted.map(grant=>grant.id),attenuation});}
          Object.assign(entry,{token:child,token_type:'Bearer',expires_at:Math.floor((await tx.get(childKey)).expiresAt/1000)});}
        list.push(entry);
      }
      if(consent)requiresConsent.push(name);values[name]=list;
    }
    return {revision:preferences.revision,values,requiresConsent,pending};
  }
  /** preferences/v2 read (§5.1, §5.3, §7.4). Check (credential, grants, values) → mint each brokered member in the
   * owner's account (check, sign, confirm there) → confirm here: a grant revoked, a session ended or a value changed
   * meanwhile discards the whole answer, so a released token predates every later revocation commit. A refused mint
   * reports the member `unavailable`. Integration readers also get their connection's configuration `seq`, read first
   * so the values are at least as new as any event carrying that `seq`. */
  async preferencesV2(load,envelope,bearer){
    exact(envelope.args,['fragment']);const fragment=envelope.args.fragment;if(typeof fragment!=='string')fail('invalid_args');
    const reader=await this.store.transaction(async tx=>{const {token}=await load(tx);if(token.attenuation)fail('forbidden');return token.connection?.id??null;});
    let seq=null;if(reader&&typeof this.brokering?.seq==='function'){try{const value=await this.brokering.seq({connection:reader});if(Number.isSafeInteger(value))seq=value;}catch{/* not an integration reader */}}
    const first=await this.store.transaction(async tx=>{const {token,grants}=await load(tx);if(token.attenuation)fail('forbidden');return {token:copy(token),grants:grants.map(g=>g.id).sort(),...await this.projectV2(tx,{subject:token.subject,clientId:token.clientId,grants,fragment,token,bearer,issue:true})};});
    for(const p of first.pending){
      if(p.relation){try{const m=await this.relationImports.certify({subject:first.token.subject,clientId:first.token.clientId,clientOrigin:this.clients.get(first.token.clientId)?.origin??null,grants:p.grants,grantRecords:p.grantRecords,field:p.field,resource:p.resource,jkt:first.token.jkt??null,delegate:first.token.jwk??null,member:first.token.member??null,connection:first.token.connection??null});
        Object.assign(p.entry,{status:'available',contracts:Object.keys(m.methods),methods:m.methods,token:m.certificate,token_type:'BindleEntity',expires_at:m.exp,broker:{endpoint:m.broker.endpoint,origin:m.broker.origin,resource:m.broker.resource}});}
       catch{p.entry.status='unavailable';for(const k of ['token','token_type','expires_at','broker'])delete p.entry[k];}continue;}
      try{const m=await this.brokering.mint({clientId:first.token.clientId,record:p.record,fragment,field:p.field,methods:p.methods,...p.cv?{cv:p.cv}:{},...first.token.jkt?{jkt:first.token.jkt}:{}});
        if(typeof m.jti!=='string')throw new Error('untracked');p.jti=m.jti;p.connection=m.connection;p.grant=m.grant;Object.assign(p.entry,{status:'available',contracts:Object.keys(m.methods),methods:m.methods,token:m.token,token_type:m.tokenType,expires_at:Math.floor(m.expiresAt/1000),broker:{endpoint:m.endpoint,origin:m.origin,resource:m.resource}});}
      catch{p.entry.status='unavailable';for(const k of ['token','token_type','expires_at'])delete p.entry[k];}
    }
    await this.store.transaction(async tx=>{const {token,grants}=await load(tx),preferences=await tx.get(key('preferences',`${token.subject}|${fragment}`));if(canonical(grants.map(g=>g.id).sort())!==canonical(first.grants)||preferences?.revision!==first.revision)fail('temporarily_unavailable','These preferences changed. Read them again.');
      // X8-R3: each released brokered token remembers the consumer session it was minted for, so live introspection
      // ends with that session (sign-out, family revocation) rather than at token expiry.
      const issued=first.pending.filter(p=>!p.relation&&typeof p.entry.token==='string');if(!issued.length)return;const now=this.clock();let live=0,mine=0;
      for(const row of await tx.list(key('brokered-jti','')))if(row.value.expiresAt<=now)await tx.delete(row.key);else{live++;if(row.value.clientId===token.clientId)mine++;}
      // W5-S5: a per-app cap, so one consumer's reads cannot exhaust the shard-wide bound for every other app.
      if(mine+issued.length>256||live+issued.length>4096)fail('temporarily_unavailable','Too many brokered tokens are outstanding. Try again shortly.');
      for(const p of issued)await tx.set(key('brokered-jti',await digest(this.crypto,`brokered-jti\0${p.jti}`)),{clientId:token.clientId,grants:first.grants,fragment,field:p.field,connection:p.connection,grant:p.grant,expiresAt:p.entry.expires_at*1000,...token.familyId?{familyId:token.familyId}:{accessExpiresAt:token.expiresAt}});});
    const result={fragment,revision:first.revision,values:first.values,...first.requiresConsent.length?{requiresConsent:first.requiresConsent}:{},...seq!==null?{seq}:{}};
    if(new TextEncoder().encode(canonical(result)).length>1500000)fail('result_too_large');return {version:'0',tx:envelope.tx,result};
  }
  /** X6 snapshot port (§6.2): the integration's own preferences/v2 values without `token`, `token_type` and
   * `expires_at`, for its live grants on `fragment` bound to exactly (connection, generation); values null when none is
   * live. Reads only this shard (no resource sync, no account call), so the account's event alarm cannot deadlock. */
  async integrationSnapshot(input){
    if(!this.brokering||!this.routingKey)fail('temporarily_unavailable');exact(input,['connection','clientId','generation','fragment']);
    const {connection,clientId,generation,fragment}=input;if(typeof connection!=='string'||typeof clientId!=='string'||!Number.isSafeInteger(generation)||typeof fragment!=='string')fail('invalid_args');
    const subject=`${this.issuer}/entities/${this.routingKey}`,match=g=>g?.active&&g.subject===subject&&g.clientId===clientId&&g.fragment===fragment&&g.connection?.id===connection&&g.connection?.generation===generation;
    const candidates=await this.store.transaction(async tx=>(await tx.list(key('grant',''))).map(r=>r.value).filter(match));
    const live=[];for(const g of candidates){try{await this.active(subject,g.epoch);live.push(g.id);}catch{/* stale epoch */}}
    return this.store.transaction(async tx=>{
      const preferences=await tx.get(key('preferences',`${subject}|${fragment}`)),grants=[];for(const id of live){const g=await tx.get(key('grant',id));if(match(g)&&await this.referenceMatches(tx,fragment,g,preferences))grants.push(g);}
      if(!grants.length)return {revision:preferences?.revision??null,values:null};
      const out=await this.projectV2(tx,{subject,clientId,grants,fragment,issue:false});return {revision:out.revision,values:out.values};});
  }
  /** Introspection, federation half (§5.7): a live grant of `clientId` approves this brokered resource for (fragment,
   * field) at its generation, the value still assigns it, every presented method is granted, and the consumer's own
   * connection is current. */
  /** Durable, per-owner-shard client-assertion jti replay record for brokered introspection (wargame 2026-10-23): true
   * when (clientId, jti) is new and was recorded until `until` (capped at 5 minutes); false for a replay or a full table
   * (refuse rather than forget a live jti). Never routed; the introspection handler calls it after resolving the owner. */
  async brokeredAssertionReplay(input){
    exact(input,['clientId','jti','until']);if(!boundedString(input.clientId,2048)||!boundedString(input.jti,256)||!Number.isSafeInteger(input.until))fail('invalid_args');
    const name=key('assertion-jti',await digest(this.crypto,`${input.clientId}\n${input.jti}`));
    return this.store.transaction(async tx=>{const now=this.clock(),existing=await tx.get(name);if(existing&&existing.expiresAt>now)return false;let live=0;for(const row of await tx.list(key('assertion-jti',''))){if(row.value.expiresAt<=now)await tx.delete(row.key);else live++;}if(live>=ASSERTION_REPLAY_ROWS)return false;await tx.set(name,{expiresAt:Math.min(Math.max(input.until,now+1000),now+300000)});return true;});
  }
  async brokeredGrantLive(input){
    if(!this.brokering||!this.routingKey||!object(input)||Object.keys(input).some(k=>!['clientId','resourceId','fragment','field','methods','jti','iat',...this.artefactVersions||input?.cv!==undefined?['cv']:[]].includes(k)))return false;
    const {clientId,resourceId,fragment,field,methods,jti,iat}=input;if(!this.clients.has(clientId)||typeof resourceId!=='string'||typeof fragment!=='string'||typeof field!=='string'||!object(methods)||typeof jti!=='string'||!Number.isSafeInteger(iat))return false;const subject=`${this.issuer}/entities/${this.routingKey}`;
    const found=await this.store.transaction(async tx=>{const resource=await tx.get(key('resource',resourceId)),preferences=await tx.get(key('preferences',`${subject}|${fragment}`)),schema=(await this.schemaRecord(tx,fragment))?.schema;
      if(resource?.provider!=='brokered'||resource.owner!==subject||!preferences||!Object.hasOwn(schema?.fields??{},field)||!Object.hasOwn(preferences.values,field)||!assignedRefs(schema.fields[field],preferences.values[field]).includes(resourceId))return [];
      // X8-R3: the session the token was minted for must still be live.
      const issued=await tx.get(key('brokered-jti',await digest(this.crypto,`brokered-jti\0${jti}`))),now=this.clock();if(!issued||issued.invalidated||issued.clientId!==clientId||issued.expiresAt<=now)return [];
      if(issued.familyId){const family=await tx.get(key('family',issued.familyId));if(!family||family.status!=='active'||family.clientId!==clientId||family.expiresAt<=now||(family.idleExpiresAt??Infinity)<=now)return [];}else if(!(issued.accessExpiresAt>now))return [];
      // X8-R2: a token from an earlier approval never passes under a later one.
      const candidates=(await tx.list(key('grant',''))).map(r=>r.value).filter(g=>g.active&&(!issued.grants||issued.grants.includes(g.id))&&g.subject===subject&&g.clientId===clientId&&g.fragment===fragment&&(g.approvedAt??0)<=iat*1000+1000&&g.fields.includes(field)&&own(g.resources,field)?.includes(resourceId)&&(g.resourceGenerations?.[resourceId]??null)===(resource.generation??null)&&Object.entries(methods).every(([c,ms])=>Array.isArray(ms)&&ms.length>0&&ms.every(m=>own(g.methods,field)?.[c]?.includes(m)&&resource.contracts[c]?.includes(m))));const matched=[];for(const g of candidates)if(await this.referenceMatches(tx,fragment,g,preferences))matched.push(g);return matched;});
    for(const g of found){try{if((g.contract_versions||input.cv)&&canonical(contractReferences(g.contract_versions,Object.keys(methods)))!==canonical(contractReferences(input.cv,Object.keys(methods))))continue;await this.active(subject,g.epoch);if(this.connections&&(!g.connection||await this.connections.check(g.connection,clientId)!==true))continue;return true;}catch{/* inactive */}}
    return false;
  }
  async rpc(bearer,envelope,{tokenHash,beforeEffect,requestOrigin,busWaits=false,busResume}={}){const load=async tx=>tokenHash?this.tokenRecord(tx,await tx.get(key('token',tokenHash))):this.token(tx,bearer);const credential=await this.store.transaction(async tx=>tokenHash?this.tokenRecord(tx,await tx.get(key('token',tokenHash))):this.token(tx,bearer));if(originBoundContract(envelope?.contract)){if(envelope.contract===APP_NOTIFICATIONS){if(envelope.method!=='createOwn')fail('unsupported_method');notificationInput(envelope.args,envelope.tx,this.clock());}else if(!ACTIVITY_METHODS.includes(envelope.method))fail('unsupported_method');const client=this.clients.get(credential.token.clientId);if(typeof requestOrigin!=='string'||requestOrigin!==client?.origin||credential.token.connection?.appOrigin!==client?.origin||!credential.token.connection)fail('forbidden','Use the approved application origin and connection.');if(!this.connections?.notificationCheck||await this.connections.notificationCheck(credential.token.connection,credential.token.clientId)!==true)fail('forbidden','App messages are not approved.');}await this.syncResources(credential.token.subject);exact(envelope,['version','tx','resource','contract','method','args']);if(envelope.version!=='0'||typeof envelope.tx!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.tx)||!object(envelope.args)||!boundedString(envelope.method,64)||new TextEncoder().encode(canonical(envelope)).length>1500000)fail('invalid_request');
    const checkTerms=async()=>{if(rpcCreatesContentOrGrant(envelope))await this.termsAllowed?.(credential.token.subject);};await checkTerms();
    if(envelope.resource==='@preferences'&&envelope.contract===PREFERENCES_V2&&(this.brokering||this.relationImports)){if(envelope.method!=='read')fail('unsupported_method');return this.preferencesV2(load,envelope,bearer);}
    const response=await this.store.transaction(async tx=>{const{token,grants}=await load(tx);let result;
      if(envelope.resource==='@preferences'&&envelope.contract===PREFERENCES&&envelope.method==='read'){if(token.attenuation)fail('forbidden');result=await this.readPreferences(tx,token,grants,envelope.args,bearer);}
      else {if(token.attenuation&&envelope.resource!==token.attenuation.reference)fail('forbidden');const effectiveArgs=copy(envelope.args);if(token.attenuation&&effectiveArgs.key!==undefined){try{objectKey(effectiveArgs.key);}catch{fail('invalid_args','A valid relative object key is required.');}const prefix=token.attenuation.scope.prefix?.replace(/\/$/,'');if(prefix)effectiveArgs.key=`${prefix}/${effectiveArgs.key}`;}let resource;if(token.attenuation)resource=await tx.get(key('resource',token.attenuation.resource));else if(this.resourceProvider&&envelope.resource!=='@profile')fail('forbidden');else if(envelope.resource==='@profile')resource=(await tx.list(key('resource',''))).map(x=>x.value).find(r=>r.owner===token.subject&&r.alias==='@profile');else resource=await tx.get(key('resource',envelope.resource));if(!resource||resource.owner!==token.subject||token.attenuation&&token.attenuation.resource!==resource.id)fail('forbidden');if(resource.provider==='brokered'||resource.provider==='relation')fail('forbidden');let authorized=false,authorizedGrant,authorizedScope={},effectivePresigned={read:false,write:false};const allowed={};for(const grant of grants){const preferences=await tx.get(key('preferences',`${token.subject}|${grant.fragment}`));if(!preferences||!await this.referenceMatches(tx,grant.fragment,grant,preferences))continue;const pinned=await this.schemaRecord(tx,grant.fragment);for(const[field,ids]of Object.entries(grant.resources)){if(token.attenuation&&(grant.fragment!==token.attenuation.fragment||field!==token.attenuation.field||token.attenuation.assignmentRevision!==(preferences.resourceRevisions?.[field]??null)))continue;if((grant.resourceGenerations?.[resource.id]??null)!==(resource.generation??null)||!ids.includes(resource.id)||!Object.hasOwn(preferences.values,field)||!assignedRefs(pinned.schema.fields[field],preferences.values[field]).includes(resource.id))continue;const currentScope=scope(asList(pinned.schema.fields[field],preferences.values[field]).find(value=>reference(value)===resource.id));if(canonical(normalizeScope(grant.resourceScopes?.[field]?.[resource.id]??{}))!==canonical(currentScope)||token.attenuation&&(canonical(token.attenuation.scope)!==canonical(currentScope)||token.attenuation.generation!==(resource.generation??null)))continue;for(const[c,ms]of Object.entries(own(grant.methods,field)??{})){if(c==='https://3sln.me/artefacts/contracts/object-storage/v1'&&ms.includes('presign')&&resource.contracts[c]?.includes('presign')){effectivePresigned.read||=ms.includes('get')&&resource.contracts[c].includes('get');effectivePresigned.write||=!currentScope.readOnly&&ms.includes('put')&&resource.contracts[c].includes('put');}allowed[c]=[...new Set([...(allowed[c]??[]),...ms.filter(m=>resource.contracts[c]?.includes(m)&&(m==='presign'&&c==='https://3sln.me/artefacts/contracts/object-storage/v1'&&this.objectURLService?(ms.includes('get')||!currentScope.readOnly&&ms.includes('put')):scopeAllows(currentScope,m,{})))])];if(c===envelope.contract&&ms.includes(envelope.method)&&resource.contracts[c]?.includes(envelope.method)&&(envelope.method==='presign'&&envelope.contract==='https://3sln.me/artefacts/contracts/object-storage/v1'&&this.objectURLService?!currentScope.readOnly||effectiveArgs.operation!=='write':scopeAllows(currentScope,envelope.method,effectiveArgs))&&!(token.attenuation&&(currentScope.prefix||currentScope.maxObjectBytes)&&envelope.method==='presign'&&!this.objectURLService)) {authorized=true;authorizedScope=currentScope;if(!authorizedGrant||grant.approvedAt<authorizedGrant.approvedAt)authorizedGrant=grant;}}}}
        if(envelope.contract===DESCRIPTOR&&envelope.method==='describe'&&Object.values(allowed).some(ms=>ms.length)){exact(envelope.args,[]);result={id:token.attenuation?token.attenuation.reference:resource.id,...token.attenuation?{}:{label:resource.label},contracts:allowed,limits:{...(resource.limits??{maxRequestBytes:1500000,maxResultBytes:1500000,txRetentionSeconds:86400}),...token.attenuation?.scope.maxObjectBytes?{maxObjectBytes:Math.min(resource.limits?.maxObjectBytes??1048576,token.attenuation.scope.maxObjectBytes)}:{}}};}
        else {if(!authorized)fail('forbidden');if(typeof this.dispatchCapability!=='function')fail('temporarily_unavailable');result={__dispatch:{subject:token.subject,epoch:token.epoch,...token.connection?{connection:token.connection}:{},clientId:token.clientId,...originBoundContract(envelope.contract)?{requestOrigin,app:{id:token.clientId,origin:this.clients.get(token.clientId).origin,name:this.clients.get(token.clientId).name}}:{},resource:resource.id,contract:envelope.contract,method:envelope.method,args:effectiveArgs,addressedResource:envelope.resource,...token.attenuation&&envelope.args.key!==undefined?{relativeKey:envelope.args.key}:{},tx:envelope.tx,resourceGeneration:resource.generation??null,scope:copy(authorizedScope),...authorizedGrant.contract_versions?.[envelope.contract]?{contractReference:copy(authorizedGrant.contract_versions[envelope.contract])}:{},grant:{fragment:authorizedGrant.fragment,digest:authorizedGrant.digest,...authorizedGrant.version?{version:authorizedGrant.version}:{},readSince:authorizedGrant.readSince??authorizedGrant.id},busWaits,...busResume!==undefined?{busResume}:{},effectivePresigned,allowedStorageMethods:allowed['https://3sln.me/artefacts/contracts/object-storage/v1']??[]}};}
      }
      if(new TextEncoder().encode(canonical(result)).length>1500000)fail('result_too_large');return {version:'0',tx:envelope.tx,result};
    });
    if(response.result?.__dispatch){const context=response.result.__dispatch;context.reauthorize=async()=>{await checkTerms();if(originBoundContract(context.contract)){if(requestOrigin!==this.clients.get(context.clientId)?.origin||context.connection?.appOrigin!==requestOrigin||!this.connections?.notificationCheck||await this.connections.notificationCheck(context.connection,context.clientId)!==true)fail('forbidden','App messages are not approved.');}await this.syncResources(context.subject);const valid=await this.store.transaction(async tx=>{const {token,grants}=await load(tx);const resource=await tx.get(key('resource',context.resource));if(!resource||resource.owner!==token.subject||(resource.generation??null)!==context.resourceGeneration)fail('forbidden');for(const grant of grants){if(context.grant&&(grant.fragment!==context.grant.fragment||grant.digest!==context.grant.digest||(grant.readSince??grant.id)!==context.grant.readSince))continue;const preferences=await tx.get(key('preferences',`${token.subject}|${grant.fragment}`)),pinned=await this.schemaRecord(tx,grant.fragment);if(!preferences||!await this.referenceMatches(tx,grant.fragment,grant,preferences))continue;for(const [field,ids] of Object.entries(grant.resources))if((!token.attenuation||grant.fragment===token.attenuation.fragment&&field===token.attenuation.field&&token.attenuation.resource===resource.id&&canonical(token.attenuation.scope)===canonical(context.scope)&&token.attenuation.generation===context.resourceGeneration&&token.attenuation.assignmentRevision===(preferences.resourceRevisions?.[field]??null))&&ids.includes(resource.id)&&(grant.resourceGenerations?.[resource.id]??null)===(resource.generation??null)&&Object.hasOwn(preferences.values,field)&&assignedRefs(pinned.schema.fields[field],preferences.values[field]).includes(resource.id)&&canonical(normalizeScope(grant.resourceScopes?.[field]?.[resource.id]??{}))===canonical(scope(asList(pinned.schema.fields[field],preferences.values[field]).find(value=>reference(value)===resource.id)))&&canonical(normalizeScope(grant.resourceScopes?.[field]?.[resource.id]??{}))===canonical(context.scope)&&(context.method==='presign'&&context.contract==='https://3sln.me/artefacts/contracts/object-storage/v1'&&this.objectURLService?!context.scope.readOnly||context.args.operation!=='write':scopeAllows(context.scope,context.method,context.args))&&grant.methods[field]?.[context.contract]?.includes(context.method)&&resource.contracts[context.contract]?.includes(context.method))return true;}fail('forbidden');});await beforeEffect?.();return valid;};if(context.contractReference){if(typeof this.contractVersion!=='function')fail('artefact_unavailable');await this.contractVersion({existing:true,contract:context.contract,reference:context.contractReference,method:context.method,args:context.args});}response.result=envelope.contract==='https://3sln.me/artefacts/contracts/object-storage/v1'&&envelope.method==='presign'&&envelope.contract==='https://3sln.me/artefacts/contracts/object-storage/v1'&&this.objectURLService?(await context.reauthorize(),await this.objectURLService.mint(bearer,envelope)):await this.dispatchCapability(context);if(context.method==='capabilities'&&context.contract==='https://3sln.me/artefacts/contracts/object-storage/v1'&&this.objectURLService&&!response.result?.__federationError)response.result={...response.result,read:context.allowedStorageMethods.includes('get'),write:context.allowedStorageMethods.includes('put')&&!context.scope.readOnly,delete:context.allowedStorageMethods.includes('delete')&&!context.scope.readOnly,presigned:context.effectivePresigned};if(context.contractReference&&!response.result?.__federationError)response.result=(await this.contractVersion({existing:true,contract:context.contract,reference:context.contractReference,method:context.method,args:context.args,result:response.result})).result;if(context.relativeKey!==undefined&&response.result?.object?.key!==undefined)response.result={...response.result,object:{...response.result.object,key:context.relativeKey}};if(new TextEncoder().encode(canonical(response.result)).length>1500000)fail('result_too_large');}
    return response;
  }
}

// ART-5 engine surface over the existing federation provider; adapters retain the service facade.
export class PinGrantRequests extends AppAction{static operation='federation.pin-grant-requests';static deps=['federation'];run({federation}){return federation.pinRequests(this.input);}}
export class ConfigureGrantPreferences extends AppAction{static operation='federation.configure-grant-preferences';static deps=['federation'];constructor({authority,...options}={}){super(options);this.authority=authority;}run({federation}){return federation.configure(this.authority,this.input);}}
export class GrantPreferenceConsumers extends AppQuery{static operation='federation.grant-preference-consumers';static deps=['federation'];constructor({authority,...options}={}){super(options);this.authority=authority;}fetch({federation}){return federation.preferences(this.authority);}}
