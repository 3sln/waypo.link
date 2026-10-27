import {present} from './attrs.mjs';
import {h,icon,select} from './release-primitives.mjs';
import {interfaceText as tx} from './interface-text.mjs';
import {button,form,input,data,when,formatTime,errorText} from './admin-access.mjs';
import {consoleView as flagsConsoleView} from './admin-flags.mjs';
import {caseState,ORG_CASES_VIEW,DAILY_DECISIONS,CATEGORIES,CATEGORY_REQUIRED,REASON_REQUIRED,availableDecisions,approvable,proposable,singleDecisions,excludableChannels} from '../bl/admin-org-cases.mjs';
// ORG-12d operator screens: the held-claim queue, a case with its evidence and timeline, single-operator decisions,
// two-operator proposals and approvals, channel exclusions, contest decisions and the operator audit. Privacy
// (design §12d.8): the server sends channel kinds and enrolment ages only, never addresses; the console shows nothing
// else. Owner data (handles, ids, digests) is rendered translate="no".
const heading=(title,id='admin-heading')=>h('h1',title).props({id,tabIndex:-1});
const subheading=(title,id)=>h('h2',title).props({id,tabIndex:-1});
const panel=(...children)=>h('section',...children).classes('panel');
const pill=(text,cls='subtle')=>h('span',text).classes('pill',cls);
const facts=rows=>h('dl',...rows.filter(Boolean).flatMap(([term,value])=>[h('dt',term),h('dd',value)])).classes('admin-facts');
const time=(value,locale)=>Number.isFinite(value)?when(value,locale):data('—');
const handleOf=value=>typeof value==='string'&&value?data('@'+value,'strong'):h('span','No public handle').classes('muted');
export const KIND_LABEL={'break-glass':'Break-glass claim','lapse-claim':'Lapse claim'};
export const QUEUE_STATE={held:'Held for support',contest:'Contest',escalated:'Escalated'};
export const CLAIM_STATE={gathering:'Gathering',waiting:'Waiting',held:'Held for support',final:'Final notice',effective:'Took effect',aborted:'Aborted',withdrawn:'Withdrawn',closed:'Closed',escalated:'Escalated',pending:'Pending'};
export const CONTEST_STATE={window:'Contest window open',open:'Contest open',upheld:'Contest upheld',rejected:'Contest rejected',closed:'Contest closed'};
export const CHANNEL_KIND={email:'Email',push:'Push',session:'Known session',credential:'Known credential'};
export const DECISION_LABEL={acknowledge:'Acknowledge',note:'Add note',abort:'Abort claim',close:'Close and refund',proceed:'Propose to proceed',uphold:'Propose to uphold the contest',reject:'Propose to reject the contest'};
export const DECISION_NAME={acknowledge:'Acknowledge',note:'Note',abort:'Abort',close:'Close',proceed:'Proceed',uphold:'Uphold contest',reject:'Reject contest'};
export const CATEGORY_LABEL={'evidence-reviewed':'Evidence reviewed','channel-compromised':'Channel compromised','channel-undeliverable':'Channel undeliverable','owner-responded':'Owner responded','insufficient-evidence':'Insufficient evidence',other:'Other'};
export const ORG_CASE_ERRORS={
 second_operator_required:'A different operator must approve this decision.',
 operator_pair_barred:'A different pair of operators must decide after an excluded channel disputed.',
 operator_conflict:'You are a party to this claim or a member of this organization, so you cannot decide it.',
 last_channel:'The owner’s last channel can never be excluded.',
 invalid_exclusion:'Only owner channels that disputed a claim, or that cannot be reached, can be excluded.',
 owner_proof_recent:'The owner’s elevated proof ended a claim recently; support cannot proceed.',
 decision_limit:'You reached the limit of 20 decisions today. Another operator must continue.',
 operator_capability_required:'Your account does not hold the support capability for organization cases.',
 step_up_required:'Confirm with a passkey and try again.',
 passkey_required:'Add a passkey to this account to decide organization cases.',
 passkey_cancelled:'The passkey request was cancelled or timed out.',
 reason_required:'Give a reason of 10 to 500 characters.',
 category_required:'Choose a reason category.',
 invalid_reason:'Give a reason of at most 280 characters for a lapse claim.',
 not_found:'This case is no longer available. Reload the queue.',
 not_allowed:'This decision is not available for this case now.',
 operator_unverified:'The organization could not verify this decision. Try again.',
 conflict:'The case changed. Review it again before deciding.'
};
const orgCaseError=(error,locale)=>ORG_CASE_ERRORS[error.code]??errorText(error,locale);
const OUTCOME={proposed:'Proposal recorded. A second operator must approve it.',approved:'Decision approved and applied.',recorded:'Decision recorded.'};
function messages(s,state){
 return h('div',s.error?h('div',h('p',orgCaseError(s.error,state.locale)),button(state,'Dismiss','org-cases-dismiss',{},'text-button',false)).attrs({role:'alert'}).classes('alert','error','admin-alert'):null,
  s.notice?h('p',icon('check'),h('span',OUTCOME[s.notice.outcome]??'Decision recorded.')).attrs({role:'status'}).classes('alert','success'):null).classes('alerts');
}
function tabs(state,s){const screen=s.screen??'queue';return h('div',button(state,'Held claims','org-cases-queue',{},'button '+(screen==='audit'?'secondary':'primary')),button(state,'Operator audit','org-cases-audit',{},'button '+(screen==='audit'?'primary':'secondary'))).classes('buttons').attrs({'aria-label':'Organization case sections'});}
// ---- queue ----
function queueView(state,s){
 const list=s.list;
 return h('div',h('div',h('div',heading('Organization cases'),h('p','Claims held for support. You see channel kinds and ages, never addresses.').classes('muted')),button(state,'Refresh','org-cases-load',{},'button secondary')).classes('page-heading','admin-heading'),tabs(state,s),messages(s,state),
  panel(subheading('Held claims','org-cases-queue-heading'),!list?h('p',state.busy?'Loading…':'The queue is not loaded.').attrs({role:'status'}).classes('muted'):list.cases.length?h('ul',...list.cases.map(c=>h('li',h('div',handleOf(c.handle),pill(KIND_LABEL[c.kind]??'Organization case'),pill(QUEUE_STATE[c.state]??'Needs review',c.state==='contest'?'warning':'subtle')).classes('chip-list'),h('p',tx('Waiting since {time}',{time:formatTime(c.since,state.locale)})).classes('muted'),button(state,'Open case','org-cases-open',{org:c.org},'button secondary')).classes('org-case-row').key('case:'+c.org))).classes('plain-list','org-case-list'):h('p','No claims are waiting for support.').classes('muted'),
   list&&(list.next||list.startAfter)?h('div',list.startAfter?button(state,'Previous page','org-cases-back',{},'button secondary'):null,list.next?button(state,'Next page','org-cases-load',{startAfter:list.next},'button secondary'):null).classes('buttons'):null));
}
// ---- case ----
function channelsView(state,c){
 const rows=c.channels??[];if(!rows.length)return h('p','No owner channels were recorded.').classes('muted');
 return h('table',h('caption','Owner channels (kinds and ages only)'),h('thead',h('tr',h('th','Channel').attrs({scope:'col'}),h('th','Enrolled').attrs({scope:'col'}),h('th','Status').attrs({scope:'col'}))),
  h('tbody',...rows.map(ch=>h('tr',h('td',CHANNEL_KIND[ch.kind]??'Other channel'),h('td',tx('{count} days before now',{count:String(ch.ageDays??0)})),h('td',h('span',ch.disputed?pill('Disputed','warning'):null,ch.undeliverable?pill('Undeliverable','warning'):null,ch.excluded?pill('Excluded','danger'):null,!ch.disputed&&!ch.undeliverable&&!ch.excluded?data('—'):null).classes('chip-list'))).key('channel:'+ch.id)))).classes('admin-table','org-case-channels');
}
function timelineView(state,c){
 const rows=c.timeline??[];if(!rows.length)return h('p','No transitions yet.').classes('muted');
 return h('ol',...rows.map((e,i)=>h('li',time(e.at,state.locale),data(' '),data(e.event,'code'),data(' '),CLAIM_STATE[e.from]?h('span',CLAIM_STATE[e.from]):data('—'),data(' → '),CLAIM_STATE[e.to]?h('span',CLAIM_STATE[e.to]):data('—')).key('t:'+i))).classes('plain-list','org-case-timeline');
}
function breakGlassFacts(state,c){
 return facts([['Organization',handleOf(c.handle)],['Kind',KIND_LABEL[c.kind]],['State',pill(CLAIM_STATE[c.state]??'Unknown',c.state==='held'?'warning':'subtle')],c.contest?['Contest',pill(CONTEST_STATE[c.contest.state]??'Contest')]:null,c.contest?.until?['Contest window ends',time(c.contest.until,state.locale)]:null,
  ['Track',data(c.track??'—')],['Track S causes',c.causes?.length?h('span',...c.causes.map(x=>data(x,'code'))).classes('chip-list'):h('span','None')],c.frozen?['Frozen','A file recovery is pending']:null,
  ['Started',time(c.createdAt,state.locale)],['Paid at',time(c.paidAt,state.locale)],['Wait ends',time(c.waitEndsAt,state.locale)],['Held since',time(c.held?.enteredAt,state.locale)],['Acknowledged',time(c.held?.ackAt,state.locale)],['Final notice ends',time(c.finalEndsAt,state.locale)],
  ['Reason category',data(c.category??'—','code')],['Statement digest',data(String(c.statementDigest??'').slice(0,16)+(c.statementDigest?'…':''),'code')],['Billing held',c.billingHeld?'Yes':'No'],['Objections',data(c.objections??0)],['Owner account',data(c.ownerStatus??'—')]]);
}
function lapseFacts(state,c){return facts([['Organization',handleOf(c.handle)],['Kind',KIND_LABEL[c.kind]],['State',pill(CLAIM_STATE[c.state]??'Unknown','warning')],['Escalated',time(c.escalatedAt,state.locale)],['Proceed approved',c.approved?'Yes':'No']]);}
function decisionForm(state,c,pending){
 const decision=pending.decision,approving=pending.approve===true,p=approving?approvable(c):null,exclusion=c.kind==='break-glass'&&decision==='proceed';
 const fields=[
  CATEGORY_REQUIRED.includes(decision)?select('category','Reason category',[['','Choose a category'],...CATEGORIES.map(id=>[id,CATEGORY_LABEL[id]])],''):null,
  REASON_REQUIRED.includes(decision)||decision==='acknowledge'?input('reason',REASON_REQUIRED.includes(decision)?(c.kind==='lapse-claim'?'Reason (10–280 characters)':'Reason (10–500 characters)'):'Reason (optional)','text',{required:REASON_REQUIRED.includes(decision),minLength:REASON_REQUIRED.includes(decision)?10:undefined,maxLength:c.kind==='lapse-claim'?280:500,autocomplete:'off'},'The organization sees only a digest. The text stays in an admin-only note that operators read in the operator audit.'):null,
  exclusion&&!approving?(excludableChannels(c).length?h('fieldset',h('legend','Exclude owner channels for this decision'),h('p','Only channels that disputed a claim or cannot be reached are listed. The owner’s last channel can never be excluded.').classes('field-help'),...excludableChannels(c).map(ch=>h('label',h('input').props({type:'checkbox',name:'exclude',value:ch.id}).attrs({'data-list':''}).key('exclude:'+ch.id),h('span',CHANNEL_KIND[ch.kind]??'Other channel',data(' '),tx('({count} days)',{count:String(ch.ageDays??0)}),ch.disputed?pill('Disputed','warning'):null,ch.undeliverable?pill('Undeliverable','warning'):null)).classes('checkbox-field'))).classes('admin-fieldset'):h('p','No channel can be excluded in this decision.').classes('muted')):null,
  exclusion&&approving?h('p',p.exclude.length?tx('This approval excludes {count} owner channels, as proposed.',{count:String(p.exclude.length)}):'This approval excludes no owner channels.').classes('field-help'):null,
  h('p','Passkey confirmation is required for every decision.').classes('field-help')
 ];
 const title=approving?'Approve proposal':DECISION_LABEL[decision];
 return panel(h('h2',title).props({id:'org-case-form-heading',tabIndex:-1}),TWO_OPERATOR_NOTE[decision]&&!approving?h('p',TWO_OPERATOR_NOTE[decision]).classes('muted'):null,
  form(state,fields,'org-cases-decide','Confirm with passkey',{danger:['abort','close','proceed','uphold','reject'].includes(decision)}),button(state,'Cancel','org-cases-form',{decision:null},'button secondary'));
}
const TWO_OPERATOR_NOTE={proceed:'This only proposes. A second, different operator must approve within 72 hours. A 7-day final notice with fresh abort links follows.',uphold:'This only proposes. A second, different operator must approve; upholding reinstates the former owner.',reject:'This only proposes. A second, different operator must approve.'};
function decisionsView(state,s,c){
 const left=Number.isSafeInteger(s.decisionsLeft)?s.decisionsLeft:c.decisionsLeft,available=availableDecisions(c),p=c.proposal,approve=approvable(c);
 const seizing=c.kind==='lapse-claim'?['proceed']:['proceed','uphold','reject'];
 return panel(h('h2','Decisions'),Number.isSafeInteger(left)?h('p',tx('{count} of {limit} decisions left today',{count:String(left),limit:String(DAILY_DECISIONS)})).classes('muted'):null,
  c.seizingEnabled===false?h('p','Proceeding and rejecting contests are turned off for this organization. Acknowledging, notes, aborts, closures and upholding contests remain.').attrs({role:'note'}).classes('alert','warning-note'):null,
  c.barred===true?h('p','You were part of the pair that excluded a channel that later disputed. A different pair of operators must decide.').attrs({role:'note'}).classes('alert','warning-note'):null,
  p?h('div',h('h3','Pending proposal'),facts([['Decision',DECISION_NAME[p.decision]??'Decision'],['Proposed',time(p.at,state.locale)],['Lapses',time(p.expiresAt,state.locale)],p.decision==='proceed'?['Channels excluded',data((p.exclude??[]).length)]:null]),
   p.mine?h('p','Waiting for a second operator. You cannot approve your own proposal.').attrs({role:'status'}).classes('muted'):p.proposerActive===false?h('p','The operator who proposed this no longer holds the support capability. Proposing again starts a new proposal.').attrs({role:'note'}).classes('alert','warning-note'):approve?button(state,'Approve proposal','org-cases-form',{approve:true},'button primary'):h('p','You cannot approve this proposal.').classes('muted')).classes('org-case-proposal'):null,
  !available.length&&!(c.allowed??[]).some(d=>seizing.includes(d))?h('p','No decision is available for this case now.').classes('muted'):null,
  h('div',...singleDecisions(c).map(d=>button(state,DECISION_LABEL[d],'org-cases-form',{decision:d},'button secondary'+(['abort','close'].includes(d)?' danger-button':''))),...proposable(c).map(d=>button(state,DECISION_LABEL[d],'org-cases-form',{decision:d},'button secondary'))).classes('buttons'),
  s.pending?decisionForm(state,c,s.pending):null);
}
function caseView(state,s){
 const c=s.detail;
 const top=h('div',h('div',heading('Organization case','org-case-heading'),h('p','Evidence stays with support. The claim never stores uploads, addresses or the statement’s text.').classes('muted')),h('div',button(state,'Back to queue','org-cases-queue',{},'button secondary'),c?button(state,'Reload case','org-cases-open',{org:c.org},'button secondary'):null).classes('buttons')).classes('page-heading','admin-heading');
 if(!c)return h('div',top,messages(s,state),panel(h('p',state.busy?'Loading…':'This case is not loaded.').attrs({role:'status'}).classes('muted')));
 return h('div',top,messages(s,state),panel(h('h2','Summary'),c.kind==='lapse-claim'?lapseFacts(state,c):breakGlassFacts(state,c)),
  c.kind==='break-glass'?panel(h('h2','Evidence'),channelsView(state,c),c.disputes?.length?h('div',h('h3','Disputes'),h('ul',...c.disputes.map((d,i)=>h('li',time(d.at,state.locale),data(' '),h('span',CHANNEL_KIND[(c.channels??[]).find(ch=>ch.id===d.channel)?.kind]??'Other channel'),d.excluded?pill('From an excluded channel','danger'):null).key('d:'+i))).classes('plain-list')):null):null,
  c.kind==='break-glass'?panel(h('h2','Timeline'),timelineView(state,c)):null,
  decisionsView(state,s,c));
}
// ---- audit ----
function auditView(state,s){
 const a=s.audit;
 return h('div',h('div',h('div',heading('Organization cases'),h('p','Every operator action on organization cases, from the hash-chained admin audit.').classes('muted'))).classes('page-heading','admin-heading'),tabs(state,s),messages(s,state),
  panel(h('h2','Operator audit').props({id:'org-case-audit-heading',tabIndex:-1}),!a?h('p',state.busy?'Loading…':'The audit is not loaded.').attrs({role:'status'}).classes('muted'):a.entries.length?h('ul',...a.entries.map(e=>h('li',facts([['Time',time(e.at,state.locale)],['Operator',e.actor?.handle?data('@'+e.actor.handle):data('—')],['Action',data(e.action,'code')],e.reason?['Reason',data(e.reason)]:null,['Organization',e.target?data(e.target,'code'):data('—')],e.after?.decision?['Decision',data(e.after.decision,'code')]:null,['Outcome',data(e.after?.outcome??e.after?.code??e.phase??'—','code')]])).key('a:'+e.seq))).classes('plain-list','org-case-audit'):h('p','No operator actions are recorded yet.').classes('muted'),
   a&&(a.next||a.before)?h('div',a.before?button(state,'Newest entries','org-cases-audit',{},'button secondary'):null,a.next?button(state,'Older entries','org-cases-audit',{before:a.next},'button secondary'):null).classes('buttons'):null));
}
export function orgCasesView(state){const s=caseState(state);return h('div',s.screen==='case'?caseView(state,s):s.screen==='audit'?auditView(state,s):queueView(state,s)).classes('admin-org-cases');}
// Extends only the console's public export seam (as admin-flags does): the shared frame, modal and navigation stay
// the original dodo nodes. The nav item exists for administrators only; boot is never an operator.
export function consoleView(state){
 const mine=state.view===ORG_CASES_VIEW&&state.mode==='admin',base=flagsConsoleView(mine?{...state,view:'overview'}:state);
 function extend(node){if(!node||typeof node!=='object'||typeof node.tag!=='string')return node;const classes=node.$?.classes??[],nav=classes.includes('admin-nav'),screen=mine&&classes.includes('admin-screen'),item=mine&&classes.includes('admin-nav-item');
  const children=screen?[orgCasesView(state)]:node.args.map(arg=>Array.isArray(arg)?arg.map(extend):extend(arg));
  if(nav&&state.mode==='admin')children.push(button(state,'Organization cases','navigate',{view:ORG_CASES_VIEW},'admin-nav-item'+(mine?' active':'')).attrs(present({'aria-current':mine?'page':undefined})));
  return h(node.tag,...children).props(node.p).attrs(present({...node.$?.attrs,...item?{'aria-current':undefined}:{}})).classes(...(item?classes.filter(name=>name!=='active'):classes)).style(node.$?.styling).data(node.$?.dataset).on(node.hooks).key(screen?'screen:'+ORG_CASES_VIEW:node.k);
 }
 return h('div',h('style',`.admin-org-cases{min-width:0}.admin-org-cases .panel{min-width:0;overflow-wrap:anywhere}.admin-org-cases .buttons{flex-wrap:wrap}.admin-org-cases .admin-facts dd{min-width:0;overflow-wrap:anywhere}.admin-org-cases .org-case-row{display:grid;gap:.5rem;padding:.75rem 0;border-bottom:1px solid var(--border,rgba(127,127,127,.25))}.admin-org-cases table{width:100%;border-collapse:collapse;display:block;overflow-x:auto}.admin-org-cases th,.admin-org-cases td{text-align:start;padding:.5rem;vertical-align:top}.admin-org-cases .org-case-timeline li{display:flex;flex-wrap:wrap;gap:.25rem}.admin-org-cases .button{min-height:44px}`).attrs({translate:'no'}),extend(base));
}
