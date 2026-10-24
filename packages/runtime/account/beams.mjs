import {BeamService} from '../../beaming/index.mjs';
import {capability,recordFlag,featureConfig} from './flags.mjs';
// AccountController slice 11, Beaming (docs/architecture/app-engine.md §12): beams, beam contacts and invites.
// `methods` are installed on AccountController.prototype (`this` is the controller); `rpc` lists the methods
// `invoke` accepts and the placement policy it applies to each (packages/runtime/account/index.mjs).
import {BeamError} from '../../beaming/index.mjs';
import {CloudflareTurnAdapter} from '../../beaming/turn.mjs';
import {encryptSecret,decryptSecret} from '../secrets.mjs';

export const BEAM_ICE_LEASE_MS=60000,BEAM_ICE_MAX_ISSUES=4,BEAM_RELAY_RESERVATION_FACTOR=4,BEAM_TERMINAL=Object.freeze(['cancelled','rejected','complete']);
// `true` is the pre-round-3 single-issue marker; it carries no usernames and allows no re-issue window of its own.
const iceSlot=raw=>raw===true?{state:'issued',count:1,expiresAt:0,usernames:[]}:raw==='issuing'?{state:'issuing',at:0,count:1,usernames:[]}:raw&&typeof raw==='object'?{state:raw.state,at:raw.at??0,count:raw.count??0,expiresAt:raw.expiresAt??0,usernames:Array.isArray(raw.usernames)?raw.usernames:[]}:{state:'idle',count:0,expiresAt:0,usernames:[]};
const turnUsernames=issued=>[...new Set(issued.iceServers.map(s=>s.username).filter(Boolean))];
const turnAdapter=config=>new CloudflareTurnAdapter({keyId:config.CLOUDFLARE_TURN_KEY_ID,apiToken:config.CLOUDFLARE_TURN_API_TOKEN});
const beamService=(c,owner)=>new BeamService({metadata:c.metadata,config:featureConfig(c.config,{subject:{kind:'account',owner}}),entitlement:id=>c.billing.entitlement(id)});

export const methods={
  async beamOutbox(owner,device){return this.beams.outbox(owner,device);},
  async beamStatus(owner){return beamService(this,owner).status(owner);},
  async beamCreate(owner,actor,input){recordFlag(this,owner,'BEAM_ENABLED','exposure');const result=await beamService(this,owner).create(owner,actor,input);await this.scheduleAlarm(result.expiresAt);return result;},
  async beamRaw(owner,id){return this.beams.raw(id);},
  async beamAction(owner,id,actor,operation,input){const result=await this.beams.action(id,actor,operation,input);if(operation!=='get')await this.scheduleAlarm(result.expiresAt);if(operation!=='get'&&BEAM_TERMINAL.includes(result.state))await this.beamTurnRevoke(owner,id);if(operation==='signal'&&input?.type==='complete')recordFlag(this,owner,'BEAM_ENABLED','beam_completed');return result;},
  async beamMailbox(owner,device){return this.beams.mailbox(owner,device);},
  async beamNotify(owner,input){const result=await this.beams.notify(owner,input);await this.scheduleAlarm(input.expiresAt);return result;},
  async beamProfile(owner,input){return this.beamContacts.profile(owner,input);},
  async beamContactEnable(owner,id,input){return this.beamContacts.enable(owner,id,input);},
  async beamContactRedeem(owner,url,peer){return this.beamContacts.redeem(owner,url,peer);},
  async beamContactRemember(owner,binding,url){const result=await this.beamContacts.remember(owner,binding);if(typeof url==='string'){const record=await this.metadata.get('beam/directory/'+binding.owner);record.encryptedURL=await encryptSecret({url},this.config.KEY_ENCRYPTION_KEY);await this.metadata.put('beam/directory/'+binding.owner,record);}return result;},
  async beamDirectory(owner){const rows=await this.beamContacts.directory(owner);return Promise.all(rows.map(async r=>{const record=await this.metadata.get('beam/directory/'+r.peer);return {...r,...record?.encryptedURL?await decryptSecret(record.encryptedURL,this.config.KEY_ENCRYPTION_KEY):{}};}));},
  async beamContactForget(owner,peer){return this.beamContacts.forget(owner,peer);},
  async beamPermission(owner,peer,input){return this.beamContacts.permission(owner,peer,input);},
  async beamContactInfo(owner,peer,input){return this.beamContacts.contactInfo(owner,peer,input);},
  async contactProfile(owner,url){return this.beamContacts.publicProfile(owner,url);},
  async beamDisclosed(owner,peer,input){return this.beamContacts.disclosed(owner,peer,input);},
  async beamInviteCreate(owner,input,device){const result=await this.beamContacts.createInvite(owner,input,device);const record=await this.metadata.get('beam/invite/'+result.id);record.encryptedToken=await encryptSecret({token:result.token},this.config.KEY_ENCRYPTION_KEY);await this.metadata.put('beam/invite/'+result.id,record);await this.scheduleAlarm(result.expiresAt);return result;},
  async beamInviteURL(owner,id){await this.beamContacts.invite(owner,id);const r=await this.metadata.get('beam/invite/'+id),secret=await decryptSecret(r.encryptedToken,this.config.KEY_ENCRYPTION_KEY);return `${this.config.APP_ORIGIN}/#beam-invite=${encodeURIComponent(secret.token)}`;},
  async beamInviteGet(owner,id){return this.beamContacts.invite(owner,id);},
  async beamInviteJoin(owner,token,peer){return this.beamContacts.joinInvite(owner,token,peer);},
  async beamPair(owner,id,peer,expiresAt,deviceId,senderDevice){return this.beamContacts.pair(owner,id,peer,expiresAt,deviceId,senderDevice);},
  // Wargame round 3 D1/D2 and plausible findings. Issued TURN usernames are persisted per role inside `iceIssued`
  // (stripped from every view by beamView) and revoked on every terminal transition and on the alarm sweep. A
  // credential never outlives the beam (TTL = min(300 s, remaining beam lifetime)); after it expires the participant
  // may re-issue, at most BEAM_ICE_MAX_ISSUES times, each with a new reservation, and the old username is revoked. An
  // 'issuing' marker is a lease (BEAM_ICE_LEASE_MS), so a crash mid-issuance cannot wedge the participant. When
  // revoking unused credentials fails, the reservation is kept (the credentials may still carry traffic).
  async beamIce(owner,id,actor){
    const r=await this.beams.raw(id),role=this.beams.authorize(r,actor);if(r.state!=='accepted')throw new BeamError('beam_not_accepted','Accept the selected files first.',409);
    const status=await beamService(this,owner).status(owner);if(!status.paid)throw new BeamError('beam_paid_required','The sending plan is no longer paid.',403);
    if(!status.relayEnabled)return {iceServers:capability(this.config,'BEAM_STUN_ENABLED')?[{urls:['stun:stun.cloudflare.com:3478']}]:[],relayEnabled:false};
    let prior=[],ttl=0,count=0,leaseAt=0,beamExpiresAt=0;const bytes=r.files.filter(f=>r.selected.includes(f.id)).reduce((n,f)=>n+f.size,0)*2;
    await this.metadata.transaction(async tx=>{const current=await tx.get('beam/offer/'+id);if(!current)throw new BeamError('beam_expired','This transfer has expired.',410);this.beams.authorize(current,actor);if(current.state!=='accepted')throw new BeamError('beam_not_accepted','This transfer is no longer accepted.',409);
     const now=Date.now(),slot=iceSlot(current.iceIssued[role]);
     if(slot.state==='issuing'&&slot.at+BEAM_ICE_LEASE_MS>now||slot.state==='issued'&&slot.expiresAt>now)throw new BeamError('beam_turn_already_issued','TURN credentials were already issued for this participant.',409);
     // Review follow-up (D2): the relay reservation of one beam, across both participants and every re-issue, is capped
     // at BEAM_RELAY_RESERVATION_FACTOR times one participant's envelope.
     const reserved=Number.isSafeInteger(current.relayReserved)?current.relayReserved:0;
     if(slot.count>=BEAM_ICE_MAX_ISSUES||reserved+bytes>bytes*BEAM_RELAY_RESERVATION_FACTOR)throw new BeamError('beam_turn_limit','No more TURN credentials can be issued for this transfer.',409);
     if(current.expiresAt-now<1000)throw new BeamError('beam_expired','This transfer has expired.',410);
     prior=slot.usernames;count=slot.count+1;leaseAt=now;beamExpiresAt=current.expiresAt;current.relayReserved=reserved+bytes;current.iceIssued[role]={state:'issuing',at:now,count,usernames:prior,expiresAt:slot.expiresAt};await tx.put('beam/offer/'+id,current);});
    // Wargame Q3: any failure before the credentials are recorded releases the relay reservation (when the budget
    // supports it) and returns this participant's marker to idle, so a transient provider failure cannot lock the
    // participant out of relay credentials for the life of the transfer.
    const budget=this.config.BEAM_RELAY_BUDGET;let reservation=null,held=false,committed=false,issued=null,adapter=null,issuedAt=0;
    const ours=slot=>slot?.state==='issuing'&&slot.at===leaseAt;
    try{
     reservation=await budget.reserve({owner,transfer:id,role,maxBytes:bytes,ttl:300});if(!reservation?.enforced)throw new BeamError('beam_turn_unfunded','An enforceable relay allowance is required.',503);held=true;
     // Review follow-up (D1): the TTL is computed after the reservation, so the credential never outlives the beam.
     ttl=Math.min(300,Math.floor((beamExpiresAt-Date.now())/1000));if(ttl<1)throw new BeamError('beam_expired','This transfer has expired.',410);
     adapter=turnAdapter(this.config);issuedAt=Date.now();issued=await adapter.issue({ttl});
     await budget.commit(reservation);committed=true;
     const usernames=turnUsernames(issued),expiresAt=issuedAt+ttl*1000;
     // Review follow-up (D1): the success write requires that this call still holds its issuing lease.
     await this.metadata.transaction(async tx=>{const current=await tx.get('beam/offer/'+id);if(!current)throw new BeamError('beam_expired','This transfer has expired.',410);this.beams.authorize(current,actor);if(current.state!=='accepted')throw new BeamError('beam_not_accepted','This transfer is no longer accepted.',409);if(!ours(current.iceIssued[role]))throw new BeamError('beam_turn_lease_lost','TURN issuance was superseded; try again.',409);current.iceIssued[role]={state:'issued',count,expiresAt,usernames:[...prior,...usernames.map(username=>({username,expiresAt}))]};await tx.put('beam/offer/'+id,current);});
    }catch(error){
     let unrevoked=[];
     if(issued)for(const username of turnUsernames(issued))try{await adapter.revoke(username);}catch{unrevoked.push({username,expiresAt:issuedAt+ttl*1000});}
     if(held&&!committed&&!unrevoked.length&&typeof budget.release==='function')try{await budget.release(reservation);held=false;}catch{}
     try{await this.metadata.transaction(async tx=>{const current=await tx.get('beam/offer/'+id);if(!current)return;const slot=current.iceIssued?.[role];
      if(!held&&!committed&&Number.isSafeInteger(current.relayReserved))current.relayReserved=Math.max(0,current.relayReserved-bytes);
      if(ours(slot))current.iceIssued[role]={state:'idle',count:unrevoked.length?slot.count:Math.max(0,slot.count-1),usernames:[...(slot.usernames||[]),...unrevoked]};
      else if(unrevoked.length&&slot&&typeof slot==='object')current.iceIssued[role]={...slot,usernames:[...(slot.usernames||[]),...unrevoked]};
      await tx.put('beam/offer/'+id,current);});}catch{}
     if(unrevoked.length)await this.scheduleAlarm(Date.now()+60000);
     throw error;
    }
    // The previous (expired) credentials are revoked once the new ones are recorded.
    if(prior.length)await this.beamTurnRevoke(owner,id,{only:prior.map(p=>p.username)});
    return {...issued,relayEnabled:true};
  },
  // Revokes stored TURN usernames: every one for a terminal beam (or `only` those named). A username whose
  // revocation fails is kept for the alarm sweep until its credential has expired anyway.
  async beamTurnRevoke(owner,id,{only}={}){
    const r=await this.metadata.get('beam/offer/'+id);if(!r?.iceIssued)return {pending:0};
    const targets=Object.values(r.iceIssued).flatMap(slot=>iceSlot(slot).usernames).filter(entry=>!only||only.includes(entry.username));if(!targets.length)return {pending:0};
    const adapter=turnAdapter(this.config),done=new Set();
    for(const {username,expiresAt} of targets){try{await adapter.revoke(username);done.add(username);}catch{if(expiresAt<=Date.now())done.add(username);}}
    let pending=0;
    await this.metadata.transaction(async tx=>{const current=await tx.get('beam/offer/'+id);if(!current?.iceIssued)return;for(const [role,raw] of Object.entries(current.iceIssued)){if(!raw||typeof raw!=='object')continue;const usernames=(raw.usernames||[]).filter(entry=>!done.has(entry.username));pending+=usernames.length;current.iceIssued[role]={...raw,usernames};}await tx.put('beam/offer/'+id,current);});
    if(pending)await this.scheduleAlarm(Date.now()+60000);
    return {pending};
  },
  // Alarm sweep: terminal or expired beams still holding usernames are revoked before cleanup deletes them.
  async beamTurnSweep(owner){
    for(const [path,r] of await this.metadata.list({prefix:'beam/offer/',limit:129})){if(!r?.iceIssued||!Object.values(r.iceIssued).some(slot=>iceSlot(slot).usernames.length))continue;if(BEAM_TERMINAL.includes(r.state)||r.expiresAt<=Date.now())await this.beamTurnRevoke(owner,path.slice('beam/offer/'.length));}
  },
};

export const rpc={
 beamInviteURL:{},
 beamOutbox:{},
 beamStatus:{},
 beamCreate:{},
 beamRaw:{},
 beamAction:{},
 beamMailbox:{},
 beamNotify:{},
 beamIce:{},
 beamProfile:{},
 beamContactEnable:{},
 beamContactRedeem:{},
 beamContactRemember:{},
 beamDirectory:{},
 beamContactForget:{},
 beamPermission:{},
 beamDisclosed:{},
 beamContactInfo:{},
 contactProfile:{},
 beamInviteCreate:{},
 beamInviteGet:{},
 beamInviteJoin:{},
 beamPair:{},
};
