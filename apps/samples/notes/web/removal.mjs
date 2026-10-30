// The clean-removal page (app-removal §6.4): nothing changes on load; the data-preserving choice is the default; one
// control always returns to the provider without further steps.
import {h} from '../../../../vendor/dodo/index.js';

export function removalView(r,s,t,actions){
 if(r.phase==='checking')return [h('section',h('div').classes('spinner').attrs({'aria-hidden':'true'}),h('p',t('removal.checking'))).classes('removal','card','centered')];
 if(r.phase==='neutral')return [h('section',h('h1',t('removal.neutral')),h('p',t('removal.neutralBody')).classes('muted')).classes('removal','card')];
 const option=(value,label,help)=>h('label',h('input').props({type:'radio',name:'choice',value,checked:r.choice===value,disabled:r.working}).on({change:()=>actions.set('choice',value)}),h('span',h('strong',label),h('small',help)).classes('option-text')).classes('option',r.choice===value?'selected':'');
 return [h('section',
  h('img').attrs({src:'/apps/samples/notes/web/icon.svg',alt:'',width:'48',height:'48'}).classes('removal-mark'),
  h('h1',t('removal.title')),h('p',t('removal.lead',{host:r.host})).classes('lead'),
  h('div',option('keep',t('removal.keep'),t('removal.keepHelp')),option('delete',t('removal.delete'),t('removal.deleteHelp'))).classes('options').attrs({role:'radiogroup','aria-label':t('removal.title')}),
  h('label',h('input').props({type:'checkbox',checked:r.clearLocal,disabled:r.working}).on({change:e=>actions.set('clearLocal',e.target.checked)}),h('span',t('removal.local'))).classes('check'),
  r.failed?h('p',t('removal.failed')).classes('alert').attrs({role:'alert'}):null,
  h('div',h('button',r.working?t('removal.working'):t('removal.finish')).classes('btn','primary').attrs({type:'button'}).props({disabled:r.working}).on({click:()=>actions.finish()}),
   h('button',t('removal.cancel',{host:r.host})).classes('btn','ghost').attrs({type:'button'}).props({disabled:r.working}).on({click:()=>actions.cancel()})).classes('removal-actions')
 ).classes('removal','card')];
}
