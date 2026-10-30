// Board views: pure dodo functions of the state snapshot.
import {h} from '../../../../vendor/dodo/index.js';
import {COLUMNS} from './bl.mjs';

const PATHS={plus:'M12 5v14M5 12h14',left:'M15 6l-6 6 6 6',right:'M9 6l6 6-6 6',user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',building:'M4 20V6l8-3v17M12 9h8v11M8 9v.01M8 13v.01M8 17v.01M16 13v.01M16 17v.01M2 20h20',
 check:'M5 12l5 5 9-10',bolt:'M13 3L5 14h6l-1 7 8-11h-6z',close:'M6 6l12 12M18 6L6 18',clock:'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'};
export const icon=(name,cls='icon')=>h('svg',h('path').attrs({d:PATHS[name]})).attrs({class:cls,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});
const initials=label=>String(label||'?').replace(/@.*/,'').split(/[\s._-]+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('')||'?';
// Board knows the organization only by the address the person typed (the directory shares no display name).
const orgName=org=>org.handle&&org.host?`${org.handle}@${org.host}`:'';

export function topbarStart(s,t){
 return [h('a',h('img').attrs({src:'/apps/samples/board/web/icon.svg',alt:'',width:'28',height:'28'}),h('span',t('app.name'))).classes('brand').attrs({href:'/'})];
}
export function topbarActions(s,t,send){
 if(!s.account)return [];
 const live=s.live.status;
 return [
  h('span',h('span').classes('dot'),h('span',t('live.'+live)).classes('label')).classes('chip','live-chip',`live-${live}`).attrs({'data-live':live,role:'status'}),
  h('button',icon('building'),h('span',['pending','member'].includes(s.org.phase)?t(s.org.phase==='member'?'org.badge.member':'org.badge.pending',{org:s.org.handle}):t('org.open')).classes('label')).classes('btn','ghost','org-button',s.org.phase==='pending'?'pending':'').attrs({type:'button','aria-haspopup':'dialog'}).on({click:()=>send('panel',{panel:'org'})})
 ];
}
export function gateCopy(t){return {heading:t('gate.heading'),lead:t('gate.lead'),points:[t('gate.points.1'),t('gate.points.2'),t('gate.points.3')]};}

function cardView(s,t,send,column,card,hooks){
 const index=COLUMNS.indexOf(column.id),flash=s.live.flash?.card===card.id&&Date.now()-s.live.flash.at<6000;
 const mine=card.assignee?.subject===s.account?.subject;
 return h('li',h('article',
  h('p',card.title).classes('card-title'),
  h('div',
   card.assignee?h('span',h('span',/@/.test(card.assignee.label)?initials(card.assignee.label):icon('user','icon tiny')).classes('who').attrs({'aria-hidden':'true'}),h('span',t('card.assigned',{name:mine?t('card.you'):card.assignee.label})).classes('assigned-label')).classes('assignee'):
    h('button',icon('user'),h('span',t('card.assign'))).classes('btn','ghost','small','assign').attrs({type:'button'}).on({click:()=>hooks.assign(card)}),
   h('span',
    index>0?h('button',icon('left')).classes('icon-btn','move').attrs({type:'button','aria-label':t('card.moveTo',{column:t('col.'+COLUMNS[index-1])}),title:t('card.moveTo',{column:t('col.'+COLUMNS[index-1])})}).on({click:()=>send('moveCard',{card:card.id,to:COLUMNS[index-1]})}):null,
    index<COLUMNS.length-1?h('button',icon('right')).classes('icon-btn','move').attrs({type:'button','aria-label':t('card.moveTo',{column:t('col.'+COLUMNS[index+1])}),title:t('card.moveTo',{column:t('col.'+COLUMNS[index+1])})}).on({click:()=>send('moveCard',{card:card.id,to:COLUMNS[index+1]})}):null
   ).classes('moves')
  ).classes('card-foot')
 ).classes('card',flash?'flash':'',column.id==='done'?'done':'').attrs({'data-card':card.id,'aria-label':card.title})).key(card.id);
}
function columnView(s,t,send,column,hooks){
 const label=t('col.'+column.id),draft=s.drafts[column.id]??'';
 return h('section',
  h('header',h('h2',label),h('span',String(column.cards.length)).classes('count').attrs({'aria-label':String(column.cards.length)})).classes('column-head'),
  column.cards.length?h('ul',...column.cards.map(card=>cardView(s,t,send,column,card,hooks))).classes('cards'):h('p',t('col.empty')).classes('column-empty'),
  h('form',h('label',t('col.addLabel',{column:label})).classes('visually-hidden').attrs({for:'add-'+column.id}),
   h('input').classes('input','add-input').attrs({id:'add-'+column.id,placeholder:t('col.add'),autocomplete:'off',maxlength:'120'}).props({value:draft}).on({input:e=>send('draft',{column:column.id,text:e.target.value})}),
   h('button',icon('plus'),h('span',t('col.addButton')).classes('visually-hidden')).classes('icon-btn','add-button').attrs({type:'submit','aria-label':t('col.addLabel',{column:label})}).props({disabled:!draft.trim()})
  ).classes('add-card').on({submit:e=>{e.preventDefault();send('addCard',{column:column.id});}})
 ).classes('column',`column-${column.id}`).attrs({'aria-label':label,'data-column':column.id});
}
export function boardView(s,t,send,hooks){
 if(!s.account)return [];
 if(s.storage==='error')return [h('div',h('h2',t('error.title')),h('p',s.error??'').classes('muted'),h('button',t('error.retry')).classes('btn','primary').attrs({type:'button'}).on({click:()=>send('refresh')})).classes('board-error','card')];
 if(!s.board)return [h('p',h('span').classes('spinner'),t('loading')).classes('board-loading').attrs({role:'status'})];
 const inOrg=s.org.phase==='member';
 return [
  h('header',h('div',h('h1',s.board.title||t('board.title')),h('p',inOrg?t('board.lead.org',{org:orgName(s.org)}):t('board.lead.personal')).classes('lead')),
   s.org.phase==='pending'?h('p',icon('clock'),h('span',t('org.badge.pending',{org:orgName(s.org)}))).classes('org-strip').attrs({role:'note'}):null).classes('board-head'),
  h('div',...s.board.columns.map(column=>columnView(s,t,send,column,hooks))).classes('columns')
 ];
}
export function orgSheet(s,t,send,hooks){
 const org=s.org,name=orgName(org),busy=['finding','certifying','exchanging'].includes(org.phase);
 const status=org.phase==='certifying'?t('org.certifying'):org.phase==='exchanging'?t('org.exchanging'):null;
 return [
  h('header',h('div',icon('building','icon big')).classes('sheet-mark'),h('h2',t('org.title')).attrs({id:'org-title'}),h('p',t('org.lead')).classes('muted')).classes('sheet-head'),
  ['pending','member'].includes(org.phase)?h('div',
   h('div',h('span',initials(name)).classes('org-mark').attrs({'aria-hidden':'true'}),h('div',h('strong','@'+org.handle).attrs({translate:'no'}),h('small',org.host).attrs({translate:'no'}))).classes('org-card'),
   h('p',org.phase==='member'?t('org.member',{org:name}):t('org.pending',{org:name})).classes(org.phase==='pending'?'org-note':'org-ok').attrs({role:'status'}),
   h('button',t('org.leave',{org:name})).classes('btn','ghost','danger').attrs({type:'button'}).on({click:()=>send('leaveOrg')})).classes('org-state'):
  h('div',
   h('form',h('label',t('org.address')).attrs({for:'org-address'}),
    h('div',h('input').classes('input').attrs({id:'org-address',name:'organization',autocomplete:'off',spellcheck:'false',inputmode:'email',placeholder:'team@provider.example'}).props({value:org.address,disabled:busy}).on({input:e=>send('orgAddress',{address:e.target.value})}),
     h('button',org.phase==='finding'?t('org.finding'):t('org.find')).classes('btn').attrs({type:'submit'}).props({disabled:busy||!org.address.trim()})).classes('row')
   ).classes('field','org-find').on({submit:e=>{e.preventDefault();send('findOrg');}}),
   org.error?h('p',t('org.error.'+org.error)).classes('form-error').attrs({role:'alert'}):null,
   ['found','certifying','exchanging'].includes(org.phase)?h('div',h('div',h('span',initials(name)).classes('org-mark').attrs({'aria-hidden':'true'}),h('div',h('strong','@'+org.handle).attrs({translate:'no'}),h('small',t('org.found',{host:org.host})))).classes('org-card'),
    h('button',t('org.use',{org:name})).classes('btn','primary','org-use').attrs({type:'button'}).props({disabled:busy}).on({click:()=>hooks.useOrg()}),status?h('p',status).classes('muted').attrs({role:'status'}):null).classes('org-found'):null,
   h('p',t('org.chooserNote')).classes('field-help')),
  h('div',h('button',t('org.close')).classes('btn','ghost').attrs({type:'button'}).on({click:()=>send('panel',{panel:null})})).classes('sheet-actions')
 ];
}
