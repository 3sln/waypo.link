// Meet views: pure dodo functions of the state snapshot. Media elements are plain <video> nodes; main.mjs attaches
// their streams after each render (a stream is not state).
import {h} from '../../../../vendor/dodo/index.js';

const PATHS={person:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 20a8 8 0 0 1 16 0',plus:'M12 5v14M5 12h14',link:'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',copy:'M9 9h10v10H9zM5 15V5h10',phone:'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 0-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',hang:'M3 15c5-5 13-5 18 0l-2.5 2.5-3.5-1.5v-2.5a10 10 0 0 0-6 0V16l-3.5 1.5z',shield:'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',video:'M3 7h12v10H3zM15 10l6-3v10l-6-3',clock:'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',send:'M4 12l16-8-6 16-2-6z',check:'M5 12l5 5 9-10',info:'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',external:'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6'};
const icon=(name,cls='icon')=>h('svg',h('path').attrs({d:PATHS[name]})).attrs({class:cls,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});
const hostOf=issuer=>{try{return new URL(issuer).host;}catch{return issuer??'';}};
const initials=name=>String(name||'?').split(/[\s@.]+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
const duration=ms=>{const s=Math.max(0,Math.round(ms/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};

export function headerStart(s,t,send){
 return [h('a',h('img').attrs({src:'/apps/samples/meet/web/icon.svg',alt:'',width:'28',height:'28'}),h('span',t('app.name'))).classes('brand').attrs({href:'/'}).on({click:e=>{e.preventDefault();send('leave');}})];
}

function meetingHead(m,t){
 return h('div',h('div',icon('video')).classes('meeting-mark'),h('div',h('h1',m.title).classes('meeting-title'),
  h('p',t('meeting.hostedBy',{name:m.host.label}),' ',h('span',t('meeting.on',{host:hostOf(m.host.issuer)})).classes('host-chip'))).classes('meeting-head-text')).classes('meeting-head');
}
const preview=(t,s,cls='')=>h('figure',h('video').classes('local').attrs({muted:'',autoplay:'',playsinline:'','aria-label':t('lobby.preview')}),h('figcaption',h('span').classes('live-dot'),s.account?t('lobby.as',{name:s.name.trim()||s.account.label}):t('call.you'))).classes('preview',cls);
const tip=(s,t)=>s.account?h('aside',icon('shield'),h('div',h('strong',t('lobby.tip.title')),h('p',t('lobby.tip.body')),h('a',t('lobby.tip.link',{host:hostOf(s.account.issuer)}),icon('external','icon tiny')).classes('privacy-link').attrs({href:new URL('/console?view=security',s.account.issuer).href,target:'_blank',rel:'noopener'}))).classes('tip'):null;

const nameField=(s,t,send)=>h('div',h('label',t('name.label')).attrs({for:'your-name'}),h('input').classes('input').attrs({id:'your-name',name:'name',autocomplete:'name',maxlength:'60',placeholder:t('name.placeholder')}).props({value:s.name}).on({input:e=>send('name',{name:e.target.value})}),h('small',t('name.help')).classes('help')).classes('field');
function home(s,t,i18n,send){
 if(!s.account)return h('section',
  h('div',h('div',h('h1',t('app.tagline')),h('p',t('home.lead')).classes('lead'),
   h('div',h('h2',t('home.signedOut.title')),h('p',t('home.signedOut.body')),h('button',icon('video'),t('home.signedOut.title')).classes('btn','primary','signin-cta').attrs({type:'button'}).on({click:()=>send('panel',{signIn:true})})).classes('card','host-card')).classes('hero-copy'),
   h('div',h('div',h('span',initials('Ana Ribeiro')).classes('bubble','b1'),h('span',initials('Jonas Weber')).classes('bubble','b2')).classes('stage-art'),h('div',h('span').classes('pill'),h('span').classes('pill','red')).classes('art-bar')).classes('hero-art').attrs({'aria-hidden':'true'})).classes('hero')
 ).classes('page','home');
 return h('section',
  h('header',h('h1',t('home.title')),h('p',t('home.lead')).classes('lead')).classes('page-head'),
  h('form',nameField(s,t,send),h('label',t('home.titleLabel')).attrs({for:'meeting-title'}),
   h('div',h('input').classes('input').attrs({id:'meeting-title',name:'title',autocomplete:'off',maxlength:'80',placeholder:t('home.titlePlaceholder')}).props({value:s.draft}).on({input:e=>send('draft',{title:e.target.value})}),
    h('button',icon('plus'),s.busy?t('home.creating'):t('home.create')).classes('btn','primary','create').attrs({type:'submit'}).props({disabled:s.busy})).classes('row')).classes('card','create-card').on({submit:e=>{e.preventDefault();send('createMeeting');}}),
  h('section',h('h2',t('home.recent')),s.recent.length?h('ul',...s.recent.map(m=>h('li',h('span',icon('video')).classes('recent-mark'),h('span',h('strong',m.title),h('small',i18n.relative(m.at))).classes('recent-text')).key(m.id))).classes('recent'):h('p',t('home.none')).classes('none')).classes('recent-wrap')
 ).classes('page','home');
}
function guest(s,t,send){
 const m=s.meeting;
 return h('section',h('div',meetingHead(m,t),h('p',t('guest.lead')).classes('lead'),
  h('button',icon('video'),t('guest.cta')).classes('btn','primary','big','signin-cta').attrs({type:'button'}).on({click:()=>send('panel',{signIn:true})}),
  h('p',icon('info','icon tiny'),t('guest.note')).classes('fine')).classes('card','guest-card')).classes('page','center');
}
function lobby(s,t,send,hooks){
 const m=s.meeting,host=m.role==='host';
 const side=host?h('div',meetingHead(m,t),h('h2',t('lobby.host.title')),h('p',t('lobby.host.body')).classes('muted'),
   h('div',h('label',t('lobby.link')).attrs({for:'join-link'}),h('div',h('input').classes('input','link').attrs({id:'join-link',readonly:''}).props({value:m.link??''}),h('button',icon('copy'),t('lobby.copy')).classes('btn','copy').attrs({type:'button'}).on({click:()=>hooks.copy(m.link)})).classes('row')).classes('field'),
   h('div',h('span').classes('dot'),h('span').classes('dot'),h('span').classes('dot'),h('span',t('lobby.host.title')).classes('visually-hidden')).classes('waiting').attrs({role:'status'})).classes('card','side')
  :h('div',meetingHead(m,t),h('h2',t('lobby.guest.title')),h('p',t('lobby.guest.body',{name:m.host.label})).classes('muted'),nameField(s,t,send),
   h('button',icon('video'),s.busy?t('lobby.joining'):t('lobby.join')).classes('btn','primary','big','join').attrs({type:'button'}).props({disabled:s.busy}).on({click:()=>send('join')})).classes('card','side');
 return h('section',h('div',preview(t,s),h('div',side,tip(s,t)).classes('side-col')).classes('lobby'),s.phase==='ringing'&&host?ringing(s,t,send):null).classes('page');
}
function ringing(s,t,send){
 const i=s.incoming;
 return h('div',h('div',h('div',i?.label?h('span',initials(i.label)).classes('ring-avatar'):h('span',icon('person','icon big')).classes('ring-avatar')).classes('ring'),
  h('h2',i?.label?t('ringing.host.title',{name:i.label}):t('ringing.host.anon')),h('p',t('ringing.host.body',{host:hostOf(i?.issuer)})).classes('muted'),
  h('div',h('button',t('ringing.decline')).classes('btn','decline').attrs({type:'button'}).on({click:()=>send('decline')}),h('button',icon('phone'),t('ringing.accept')).classes('btn','primary','accept').attrs({type:'button'}).on({click:()=>send('accept')})).classes('actions')).classes('card','ringing-card').attrs({role:'alertdialog','aria-modal':'true','aria-label':i?.label?t('ringing.host.title',{name:i.label}):t('ringing.host.anon')})).classes('overlay');
}
function waiting(s,t,send,{title,body}){
 return h('section',h('div',preview(t,s,'dim'),h('div',h('div',meetingHead(s.meeting,t),h('div',h('span').classes('spinner'),h('div',h('h2',title),h('p',body).classes('muted'))).classes('status-row').attrs({role:'status'}),
  s.phase==='ringing'||s.phase==='joining'?h('button',t('ringing.cancel')).classes('btn','cancel').attrs({type:'button'}).on({click:()=>send('hangUp')}):null).classes('card','side'),tip(s,t)).classes('side-col')).classes('lobby')).classes('page');
}
function approval(s,t,send){
 return h('section',h('div',h('div',icon('shield','icon big')).classes('meeting-mark','soft'),h('h1',t('approval.title')),h('p',t('approval.body')).classes('lead'),
  h('div',h('a',t('approval.open',{host:hostOf(s.account?.issuer)}),icon('external','icon tiny')).classes('btn','primary','approve-link').attrs({href:s.approval?.url??'#',target:'_blank',rel:'noopener'}),
   h('button',icon('check'),t('approval.done')).classes('btn','approval-done').attrs({type:'button'}).on({click:()=>send('approvalDone')})).classes('actions')).classes('card','guest-card')).classes('page','center');
}
function inCall(s,t,send,hooks){
 const peer=s.peer?.label??t('call.peer');
 return h('section',h('div',
  h('div',h('figure',h('video').classes('remote').attrs({autoplay:'',playsinline:'','aria-label':peer}),h('figcaption',peer)).classes('remote-tile'),
   h('figure',h('video').classes('local').attrs({muted:'',autoplay:'',playsinline:'','aria-label':t('call.you')}),h('figcaption',t('call.you'))).classes('pip'),
   h('div',icon('shield','icon tiny'),h('span',t('call.direct'))).classes('call-chip'),
   h('div',h('button',icon('hang'),h('span',t('call.hangUp'))).classes('btn','hang-up').attrs({type:'button'}).on({click:()=>send('hangUp')})).classes('controls')).classes('stage'),
  h('aside',h('h2',t('call.chat')),h('ol',...s.chat.map((c,i)=>c.system?h('li',t('call.joined',{name:c.from||peer})).classes('system').key('c'+i):h('li',h('span',c.text)).classes(c.mine?'mine':'theirs').key('c'+i))).classes('chat').attrs({'aria-live':'polite'}),
   h('form',h('input').classes('input').attrs({name:'say','aria-label':t('call.say'),placeholder:t('call.say'),autocomplete:'off',maxlength:'500'}),h('button',icon('send')).classes('icon-btn','send').attrs({type:'submit','aria-label':t('call.send')})).classes('say').on({submit:e=>{e.preventDefault();const input=e.target.elements.say;send('say',{text:input.value});input.value='';}})).classes('chat-panel')
 ).classes('call')).classes('page','wide');
}
function ended(s,t,send){
 const reason={declined:'ended.declined',expired:'ended.expired',failed:'ended.failed'}[s.endReason]??'ended.closed',m=s.meeting;
 return h('section',h('div',h('div',icon('phone','icon big')).classes('meeting-mark','soft'),h('h1',t('ended.title')),h('p',t(reason)).classes('lead'),
  m?h('p',h('strong',m.title),s.startedAt&&s.endedAt?h('span',' · '+t('ended.duration',{time:duration(s.endedAt-s.startedAt)})):null).classes('muted'):null,
  h('div',m?.role==='guest'&&s.account?h('button',t('ended.again')).classes('btn').attrs({type:'button'}).on({click:()=>send('join')}):null,h('button',t('ended.back')).classes('btn','primary','back').attrs({type:'button'}).on({click:()=>send('leave')})).classes('actions')).classes('card','guest-card','ended-card')).classes('page','center');
}
function unavailable(s,t,send){
 return h('section',h('div',h('div',icon('clock','icon big')).classes('meeting-mark','soft'),h('h1',t('unavailable.title')),h('p',t('unavailable.body')).classes('lead'),h('button',t('ended.back')).classes('btn','primary').attrs({type:'button'}).on({click:()=>send('leave')})).classes('card','guest-card')).classes('page','center');
}
export function mainView(s,t,i18n,send,hooks){
 const view=s.phase==='home'||!s.meeting&&s.phase!=='approval'?home(s,t,i18n,send)
  :s.phase==='guest'?guest(s,t,send)
  :s.phase==='approval'?approval(s,t,send)
  :s.phase==='lobby'||s.phase==='ringing'&&s.meeting.role==='host'?lobby(s,t,send,hooks)
  :s.phase==='joining'||s.phase==='ringing'?waiting(s,t,send,{title:t('ringing.guest.title'),body:t('ringing.guest.body',{name:s.meeting.host.label})})
  :s.phase==='connecting'?waiting(s,t,send,{title:t('connecting.title'),body:t('connecting.body')})
  :s.phase==='in-call'?inCall(s,t,send,hooks)
  :s.phase==='ended'?ended(s,t,send):unavailable(s,t,send);
 return [view,s.toast?h('div',t(s.toast.key,s.toast.vars)).classes('toast').attrs({role:'status'}).key('toast:'+s.toast.at):null];
}
