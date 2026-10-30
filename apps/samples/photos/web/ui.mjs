// Photos views: pure dodo functions of the state snapshot (`urls` maps own photo ids to object URLs loaded by main).
import {h} from '../../../../vendor/dodo/index.js';
import {PUBLIC_WORKS,artUrl} from './gallery.mjs';

const PATHS={plus:'M12 5v14M5 12h14',close:'M6 6l12 12M18 6L6 18',trash:'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',lock:'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',image:'M4 5h16v14H4zM8 10a1.5 1.5 0 1 0 0-.1M4 16l5-5 4 4 3-3 4 4'};
const icon=(name,cls='icon')=>h('svg',h('path').attrs({d:PATHS[name]})).attrs({class:cls,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});

export function headerStart(s,t,send){
 return [h('a',h('img').attrs({src:'/apps/samples/photos/web/icon.svg',alt:'',width:'28',height:'28'}),h('span',t('app.name'))).classes('brand').attrs({href:'/'}),
  h('nav',h('button',t('nav.explore')).classes('tab',s.tab==='explore'?'on':'').attrs({type:'button','aria-current':s.tab==='explore'?'page':'false'}).on({click:()=>send('tab',{tab:'explore'})}),
   s.account?h('button',t('nav.library')).classes('tab',s.tab==='library'?'on':'').attrs({type:'button','aria-current':s.tab==='library'?'page':'false'}).on({click:()=>send('tab',{tab:'library'})}):null).classes('tabs').attrs({'aria-label':t('app.name')})];
}
export function headerActions(s,t,send){
 // Signed out, the header's <bindle-account signed-out="panel"> is the sign-in affordance (avatar placeholder).
 return [];
}
function card(work,t,send){
 return h('li',h('button',h('img').attrs({src:artUrl(work.id,{width:640,height:480}),alt:work.title,loading:'lazy',width:'640',height:'480'}),h('span',h('strong',work.title),h('small',t('by',{name:work.by})+' · '+work.place)).classes('caption'))
  .classes('tile').attrs({type:'button'}).on({click:()=>send('view',{viewer:{kind:'public',id:work.id}})})).key(work.id);
}
function explore(s,t,send){
 return h('section',h('header',h('h1',t('explore.title')),h('p',t('explore.lead')),!s.account?h('button',icon('lock'),t('explore.cta')).classes('btn','primary','signin-cta').attrs({type:'button'}).on({click:()=>send('panel',{signIn:true})}):null).classes('hero'),
  h('ul',...PUBLIC_WORKS.map(w=>card(w,t,send))).classes('grid')).classes('page','explore');
}
function library(s,t,send,urls,hooks){
 const head=h('header',h('h1',t('library.title')),h('p',t('library.lead'))).classes('hero');
 if(s.storage==='none'||s.storage==='requesting')return h('section',head,h('div',h('div',icon('image','icon big')).classes('empty-mark'),h('h2',t('library.empty.title')),h('p',t('library.empty.body')),
  h('button',s.storage==='requesting'?t('library.requesting'):t('library.choose')).classes('btn','primary').attrs({type:'button'}).props({disabled:s.storage==='requesting'}).on({click:()=>send('requestStorage')})).classes('empty','card')).classes('page','library');
 if(s.storage==='reconnect')return h('section',head,h('div',h('div',icon('image','icon big')).classes('empty-mark'),h('h2',t('library.reconnect.title')),h('p',t('library.reconnect.body')),
  h('button',t('library.reconnect')).classes('btn','primary').attrs({type:'button'}).on({click:()=>send('panel',{signIn:true})})).classes('empty','card')).classes('page','library');
 return h('section',head,
  h('div',h('label',icon('plus'),h('span',t('library.add')),h('input').attrs({type:'file',accept:'image/png,image/jpeg,image/webp',multiple:''}).classes('visually-hidden').on({change:e=>hooks.upload(e.target)})).classes('btn','primary','add',s.busy?'busy':''),
   h('span',t('library.addHint')).classes('hint'),h('span',s.photos.length===1?t('library.countOne'):t('library.count',{count:s.photos.length})).classes('count')).classes('toolbar'),
  s.photos.length?h('ul',...s.photos.map(p=>h('li',h('button',urls.get(p.id)?h('img').attrs({src:urls.get(p.id),alt:p.title||t('app.name')}):h('span').classes('placeholder'),h('span',h('strong',p.title||'—')).classes('caption'))
   .classes('tile','own').attrs({type:'button'}).on({click:()=>send('view',{viewer:{kind:'own',id:p.id}})})).key(p.id))).classes('grid'):h('p',t('library.none')).classes('none')
 ).classes('page','library');
}
function viewer(s,t,i18n,send,urls){
 const v=s.viewer;if(!v)return null;
 const work=v.kind==='public'?PUBLIC_WORKS.find(w=>w.id===v.id):null,own=v.kind==='own'?s.photos.find(p=>p.id===v.id):null;if(!work&&!own)return null;
 return h('div',h('figure',h('img').attrs({src:work?artUrl(work.id,{width:1600,height:1200}):urls.get(own.id)??'',alt:work?.title??own.title}),
  h('figcaption',h('div',h('strong',work?.title??(own.title||'—')),h('small',work?t('viewer.public',{name:work.by,place:work.place}):t('viewer.added',{when:i18n.relative(own.addedAt)}))),
   h('div',own?h('button',icon('trash'),t('viewer.remove')).classes('btn','ghost','danger').attrs({type:'button'}).on({click:()=>send('remove',{id:own.id})}):null,
    h('button',icon('close')).classes('icon-btn').attrs({type:'button','aria-label':t('viewer.close')}).on({click:()=>send('view',{viewer:null})})).classes('viewer-actions'))).classes('viewer-card'))
  .classes('viewer').attrs({role:'dialog','aria-modal':'true','aria-label':work?.title??own.title}).on({click:e=>{if(e.target===e.currentTarget)send('view',{viewer:null});}});
}
export function mainView(s,t,i18n,send,urls,hooks){
 return [s.tab==='library'&&(s.account||s.storage==='reconnect')?library(s,t,send,urls,hooks):explore(s,t,send),viewer(s,t,i18n,send,urls),s.toast?h('div',t(s.toast.key,s.toast.vars)).classes('toast').attrs({role:'status'}).key('toast:'+s.toast.at):null];
}
