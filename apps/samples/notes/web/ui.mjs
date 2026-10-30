// Notes views: pure dodo functions of the state snapshot. `send(name, input)` runs an engine operation.
import {h} from '../../../../vendor/dodo/index.js';
import {sortedNotes} from './bl.mjs';

const PATHS={
 plus:'M12 5v14M5 12h14',search:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3',back:'M15 18l-6-6 6-6',trash:'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
 bell:'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0',gear:'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h5l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
 cloud:'M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z',device:'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm4 15h2',check:'M5 12l4 4L19 6',alert:'M12 8v5m0 3h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'
};
export const icon=(name,cls='icon')=>h('svg',h('path').attrs({d:PATHS[name]})).attrs({class:cls,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});

const syncLabel=(s,t)=>s.account?t('sync.'+s.sync.status):s.lastAccount?t('sync.reconnect'):t('sync.local');
const syncTone=s=>!s.account?'local':s.sync.status;
export function chip(s,t){
 const tone=syncTone(s);
 return h('span',icon(tone==='synced'?'cloud':tone==='error'?'alert':tone==='local'?'device':'cloud','icon chip-icon'),h('span',syncLabel(s,t)).classes('chip-label')).classes('chip','sync-chip','tone-'+tone).attrs({role:'status','aria-live':'polite','data-sync':tone});
}
export function topbarStart(s,t){
 return [h('a',h('img').attrs({src:'/apps/samples/notes/web/icon.svg',alt:'',width:'28',height:'28'}),h('span',t('app.name'))).classes('brand').attrs({href:'/'}),chip(s,t)];
}
export function topbarEnd(s,t,send){
 return [!s.account&&h('button',icon('cloud'),h('span',s.lastAccount?t('promo.reconnect'):t('promo.cta')).classes('label')).classes('btn','primary','signin-cta').attrs({type:'button'}).on({click:()=>send('panel',{signIn:true})}),
  h('button',icon('gear')).classes('icon-btn').attrs({type:'button','aria-label':t('settings.title'),title:t('settings.title')}).on({click:()=>send('panel',{settings:true})})];
}

function noteRow(note,s,t,i18n,send){
 const title=note.title.trim()||t('list.untitled'),snippet=note.body.replace(/\s+/g,' ').trim().slice(0,90);
 return h('li',h('button',h('span',title).classes('row-title',note.title.trim()?'':'untitled'),h('span',snippet||' ').classes('row-snippet'),h('span',i18n.relative(note.updatedAt)).classes('row-time'))
  .classes('row',note.id===s.selected?'active':'').attrs({type:'button','aria-current':note.id===s.selected?'true':'false'}).on({click:()=>send('select',{id:note.id})})).key(note.id);
}
function promo(s,t,send){
 if(s.account)return null;
 return h('div',h('div',icon('cloud','icon promo-icon')).classes('promo-mark'),h('div',h('strong',t('promo.title')),h('p',s.lastAccount?t('promo.again',{account:s.lastAccount.label}):t('promo.body')),
  h('button',s.lastAccount?t('promo.reconnect'):t('promo.cta')).classes('btn','primary','small').attrs({type:'button'}).on({click:()=>send('panel',{signIn:true})}))).classes('promo').key('promo');
}
function sidebar(s,t,i18n,send){
 const notes=sortedNotes(s),total=s.notes.filter(n=>!n.deleted).length;
 return h('aside',
  h('div',h('label',icon('search','icon search-icon'),h('span',t('list.search')).classes('visually-hidden'),h('input').props({value:s.query,type:'search',placeholder:t('list.search')}).classes('search').on({input:e=>send('search',{query:e.target.value})})).classes('search-wrap'),
   h('button',icon('plus'),h('span',t('list.new')).classes('label')).classes('btn','primary','new-note').attrs({type:'button'}).on({click:()=>send('create')})).classes('list-tools'),
  total?h('p',total===1?t('list.countOne'):t('list.count',{count:total})).classes('list-count'):null,
  notes.length?h('ul',...notes.map(n=>noteRow(n,s,t,i18n,send))).classes('rows'):total?h('p',t('list.noMatch',{query:s.query})).classes('no-match'):empty(t,send),
  promo(s,t,send)
 ).classes('sidebar').attrs({'aria-label':t('app.name')});
}
function empty(t,send){
 return h('div',
  h('svg',h('rect').attrs({x:'26',y:'14',width:'68',height:'86',rx:'10',class:'paper'}),h('path').attrs({d:'M40 40h40M40 54h40M40 68h26',class:'lines'}),h('circle').attrs({cx:'92',cy:'92',r:'14',class:'dot'}),h('path').attrs({d:'M86 92h12M92 86v12',class:'plus'})).attrs({viewBox:'0 0 120 120',class:'empty-art','aria-hidden':'true'}),
  h('h2',t('list.empty.title')),h('p',t('list.empty.body')),h('button',icon('plus'),t('list.empty.cta')).classes('btn','primary').attrs({type:'button'}).on({click:()=>send('create')})).classes('empty');
}
function editor(s,t,i18n,send,hooks){
 const note=s.notes.find(n=>n.id===s.selected&&!n.deleted);
 if(!note)return s.notes.some(n=>!n.deleted)?h('section',h('p',t('editor.empty'))).classes('editor','placeholder'):h('section',empty(t,send)).classes('editor','welcome');
 return h('section',
  h('div',h('button',icon('back'),h('span',t('editor.back'))).classes('btn','ghost','back').attrs({type:'button'}).on({click:()=>send('select',{id:null})}),
   h('span',t('editor.edited',{when:i18n.relative(note.updatedAt)})).classes('meta'),
   h('div',s.account&&s.reminders.enabled?h('button',icon('bell')).classes('icon-btn','remind').attrs({type:'button','aria-label':t('editor.remind'),title:t('editor.remind')}).on({click:()=>hooks.remind(note)}):null,
    h('button',icon('trash')).classes('icon-btn','delete').attrs({type:'button','aria-label':t('editor.delete'),title:t('editor.delete')}).on({click:()=>send('remove',{id:note.id})})).classes('editor-actions')).classes('editor-bar'),
  h('input').props({value:note.title,placeholder:t('editor.title')}).attrs({'aria-label':t('editor.title'),maxlength:'200'}).classes('title-input').on({input:e=>hooks.edit(note.id,{title:e.target.value})}),
  h('textarea').props({value:note.body,placeholder:t('editor.body')}).attrs({'aria-label':t('editor.body')}).classes('body-input').on({input:e=>hooks.edit(note.id,{body:e.target.value})})
 ).classes('editor').key('editor:'+note.id);
}
export function mainView(s,t,i18n,send,hooks){
 const firstRun=!s.notes.some(n=>!n.deleted);
 return [h('div',sidebar(s,t,i18n,send),editor(s,t,i18n,send,hooks)).classes('workspace','view-'+s.view,firstRun?'first-run':''),
  s.toast?h('div',t(s.toast.key,s.toast.vars)).classes('toast').attrs({role:'status'}).key('toast:'+s.toast.at):null];
}
export function settingsView(s,t,i18n,send,hooks){
 const host=s.account?new URL(s.account.issuer).host:null;
 return [h('header',h('h2',t('settings.title')),h('button',t('settings.close')).classes('btn','ghost').attrs({type:'button'}).on({click:()=>send('panel',{settings:false})})).classes('sheet-head'),
  h('section',h('h3',t('settings.sync')),
   s.account?h('div',h('p',t('settings.account',{account:s.account.label})).classes('strong'),s.sync.at?h('p',t('settings.lastSync',{when:i18n.relative(s.sync.at)})).classes('muted'):null,
    h('div',h('button',t('settings.syncNow')).classes('btn').attrs({type:'button'}).on({click:()=>send('sync')}),h('a',t('settings.manage',{host})).classes('btn','ghost').attrs({href:s.account.issuer+'/console',target:'_blank',rel:'noopener'}),h('button',t('settings.signOut')).classes('btn','ghost','danger').attrs({type:'button'}).on({click:()=>hooks.signOut()})).classes('row-actions'))
    :h('p',t('settings.signedOut')).classes('muted')).classes('group'),
  h('section',h('h3',t('settings.reminders')),h('p',t('settings.remindersBody')).classes('muted'),
   h('label',h('input').props({type:'checkbox',checked:s.reminders.enabled,disabled:!s.account||s.reminders.busy}).on({change:e=>hooks.toggleReminders(e.target)}),h('span',t('settings.remindersToggle'))).classes('switch'),
   !s.account?h('p',t('settings.remindersNeedAccount')).classes('hint'):s.reminders.error?h('p',t('settings.remindersDeclined')).classes('hint','warn'):null).classes('group'),
  h('section',h('h3',t('settings.appearance')),
   h('div',...['system','light','dark'].map(theme=>h('button',t('settings.theme.'+theme)).classes('seg',s.theme===theme?'on':'').attrs({type:'button','aria-pressed':String(s.theme===theme)}).on({click:()=>send('preference',{theme})}))).classes('segmented').attrs({role:'group','aria-label':t('settings.appearance')}),
   h('label',h('span',t('settings.language')),h('select',h('option','English').props({value:'en',selected:s.locale==='en'}),h('option','Español').props({value:'es',selected:s.locale==='es'})).classes('input').on({change:e=>send('preference',{locale:e.target.value})})).classes('field','lang')).classes('group')];
}
export function signInCopy(s,t){
 return {title:t('signin.title'),body:t('signin.body'),foot:t('signin.foot'),close:t('signin.close')};
}
