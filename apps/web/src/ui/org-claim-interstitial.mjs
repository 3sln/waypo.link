// ORG-12e owner sign-in interstitial (design §12d.12: "Someone is claiming ownership of Acme. ⟦Stop this claim⟧
// ⟦Contact support⟧"). Shown full screen by the shell when the person-level notices hold an open claim against an
// organization this person owns. Stopping goes through OrganizationsIntent (`bg-abort`); the server checks the owner's
// proof and may ask for a step-up first, in which case the shell (with its step-up card) is shown instead.
import {h,fire} from './release-primitives.mjs';
import {ownerClaims} from '../bl/org-break-glass.mjs';
import {organizationsModel} from '../bl/organizations.mjs';
import {orgStyle} from './org-console.mjs';
import {orgError,orgNotice} from './org-messages.mjs';

const SUPPORT='mailto:contact@3sln.com';
const style=`.org-claim-gate{max-width:640px;margin:0 auto;padding:32px 16px}.org-claim-gate h1{font-size:1.7rem;margin:0 0 12px}.org-claim-gate .org-actions a{display:inline-flex;align-items:center;min-height:44px;padding:10px 14px;border:1px solid var(--org-line);border-radius:6px;font-weight:600;text-decoration:underline}`;

/** The interstitial for the signed-in owner, or null when nothing is waiting (or it was set aside this session). */
export function claimInterstitial(s){
 const claims=ownerClaims(s);if(!claims.length)return null;
 const m=organizationsModel(s),busy=!!s.busy,t=(en,es)=>s.locale==='es'?es:en;
 const when=ms=>Number.isSafeInteger(ms)?new Date(ms).toLocaleString(s.locale==='es'?'es':'en',{dateStyle:'medium',timeStyle:'short'}):'';
 const plain=value=>h('bdi',String(value??'')).attrs({dir:'auto',translate:'no'});
 const name=i=>plain(i.name??(i.handle?'@'+i.handle:i.org.slice(0,8)+'…'));
 const btn=(label,action,detail,data,cls)=>h('button',label).props({type:'button',disabled:busy}).data({orgAction:data}).classes(...cls?[cls]:[]).on({click:e=>fire(e.currentTarget,'organizations',{action,...detail})});
 return h('main',h('style',orgStyle+style),
  h('div',
   h('h1',claims.length===1?[t('Someone is claiming ownership of ','Alguien reclama la propiedad de '),name(claims[0])]:t('Someone is claiming ownership of organizations you own','Alguien reclama la propiedad de organizaciones que te pertenecen')).props({id:'org-claim-gate-title',tabIndex:-1}),
   h('p',t('Admins started a claim saying the owner of record is gone. If nobody answers, it could take effect after the waiting period and make someone else the owner. Signing in to your account puts a pending claim on hold for review by 3sln.me support; only stopping it ends it.','Los administradores iniciaron una reclamación diciendo que el propietario registrado no está. Si nadie responde, podría surtir efecto tras el periodo de espera y hacer propietaria a otra persona. Iniciar sesión en tu cuenta pone en espera una reclamación pendiente para que la revise el soporte de 3sln.me; solo detenerla la termina.')),
   m?.error?h('p',orgError(s.locale,m.error)).attrs({role:'alert'}):null,
   m?.notice?h('p',orgNotice(s.locale,m.notice)).classes('org-status').attrs({role:'status','aria-live':'polite'}):null,
   ...claims.map(i=>h('section',h('h2',name(i)),
    h('p',t('Started on ','Iniciada el '),when(i.claim.createdAt),i.claim.earliestEffectAt?[t('. Earliest effect: ','. Efecto más temprano: '),when(i.claim.earliestEffectAt)]:null,'.'),
    i.claim.state==='held-for-support'?h('p',t('This claim is on hold: it cannot take effect unless 3sln.me support reviews it, and you can still stop it.','Esta reclamación está en espera: no puede surtir efecto salvo que el soporte de 3sln.me la revise, y aún puedes detenerla.')).classes('org-status'):null,
    h('p',t('If this is your organization and you did not ask for this, stop the claim. It needs no reason, and you may be asked to confirm it is you with a passkey or password you already had.','Si esta es tu organización y no lo pediste, detén la reclamación. No requiere motivo, y puede que se te pida confirmar que eres tú con una llave de acceso o contraseña que ya tenías.')),
    h('div',btn(t('Stop this claim','Detener esta reclamación'),'bg-abort',{org:i.org,claim:i.claim.id},'bg-gate-abort','org-primary'),
     h('a',t('Contact support','Contactar con el soporte')).props({href:SUPPORT}),
     btn(t('Not now','Ahora no'),'bg-dismiss',{claim:i.claim.id},'bg-gate-dismiss')).classes('org-actions')).attrs({'aria-label':t('Ownership claim','Reclamación de propiedad')}).key(i.claim.id)),
   h('p',t('You can also stop it later from Organizations, or from the link in the email or notification about the claim.','También puedes detenerla más tarde desde Organizaciones o desde el enlace del correo o de la notificación sobre la reclamación.')).classes('org-help')).classes('org-claim-gate')).classes('org-console').attrs({'aria-busy':String(busy),'data-claim-gate':''});
}
