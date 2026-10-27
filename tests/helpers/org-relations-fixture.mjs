// Local API fixture. No delivery or production capability is asserted.
export const relationsBoot=String.raw`import {Engine,Provider,dodo} from '/apps/web/src/shared/stack.mjs';
import State from '/apps/web/src/providers/browser-state.mjs';
import OrganizationsProvider from '/apps/web/src/providers/organizations.mjs';
import {OrganizationsIntent} from '/apps/web/src/bl/organizations.mjs';
import organizations,{organizationsAction} from '/apps/web/src/ui/org-console.mjs';
const ORIGIN='https://provider.example',org='00000000-0000-4000-8000-000000000001',STORAGE='https://3sln.me/artefacts/contracts/object-storage/v1';
const session={account:{id:'person'},sessionContext:'ctx'},initial={session,config:{organizationsEnabled:true,origin:ORIGIN},locale:'en'};
const REL='/api/orgs/'+org+'/relations',META='eyJhbGciOiJFUzI1NiJ9.eyJqdGkiOiJ4In0.c2ln',OTHER_META='eyJhbGciOiJFUzI1NiJ9.eyJqdGkiOiJ5In0.c2ln';
const pin={artefact:'https://3sln.me/artefacts/relations/share',version:1,digest:'d'.repeat(64)},supplyPin={artefact:'https://3sln.me/artefacts/relations/supply',version:1,digest:'c'.repeat(64)};
const P=sub=>({iss:ORIGIN,sub}),acme=P('00000000-0000-4000-8000-0000000000a1'),beta=P('00000000-0000-4000-8000-0000000000b1'),zed=P('00000000-0000-4000-8000-0000000000c1'),newco=P('00000000-0000-4000-8000-0000000000d1');
const resA=ORIGIN+'/entities/'+org+'/resources/a',resB=ORIGIN+'/entities/'+org+'/resources/b',instance=ORIGIN+'/entities/'+org+'/relations/i1';
const fragment={fragment:'https://3sln.me/artefacts/fragments/files',version:1,digest:'f'.repeat(64)};
const catalogue={relations:[{key:'share',title:'Share',description:'Share files with one organization.',publisher:'https://3sln.me',publisherVerified:false,listedBy:'3sln.me',pin,slots:[{name:'owner',title:'Owner',min:1,max:1},{name:'recipient',title:'Recipient',min:1,max:1}]}]};
const matrix={relation:pin.artefact,title:'Share',publisher:'https://3sln.me',publisherVerified:false,slot:'owner',slotTitle:'Owner',arity:{min:1,max:1},
 gives:[{to:'recipient',index:0,fragment,methods:{files:{[STORAGE]:['capabilities','get']}},required:true,actor_disclosure:'pairwise'},{to:'nobody',index:5,fragment,methods:{files:{[STORAGE]:['get']}},required:true,actor_disclosure:'pairwise'}],
 receives:[{from:'recipient',index:1,fragment,methods:{files:{[STORAGE]:['put']}},required:false,actor_disclosure:'named'}]};
const pool={resources:[{id:resA,label:'Ledgers <b>2026</b>',contracts:{[STORAGE]:['capabilities','delete','get','put']},scoping:{fields:{prefix:{maxLength:64},readOnly:{}}}},{id:resB,label:'Photos',contracts:{[STORAGE]:['get']}}]};
const disclosure={invitation:'jti-in',inviter:{identity:ORIGIN+'/identity/'+zed.sub,handle:'zed',origin:ORIGIN},relation:{id:supplyPin.artefact,title:'Supply <i>',publisher:'https://supply.example',publisherVerified:false,pin:supplyPin},slot:'supplier',counterpartySlot:'buyer',
 gives:[{index:2,fragment,methods:{files:{[STORAGE]:['get']}},required:true,actor_disclosure:'pairwise'}],receives:[{index:3,fragment,methods:{files:{[STORAGE]:['put']}},required:false,actor_disclosure:'named'}],
 warnings:['new-counterparty','same-title-different-relation'],caveats:['counterparty-sees-actor-chain','copies-cannot-be-recalled','proxying-undetectable'],expiresAt:Date.UTC(2026,10,20),disclosure:'e'.repeat(64)};
const overview=()=>({enabled:true,billing:'active',closing:false,
 instances:[{instance,relation:pin,title:'Share',slots:['owner'],state:'live',counterparts:[
  {principal:acme,handle:'acme',name:'Acme <img src=x>',slot:'recipient',as:'owner',state:'live',outgoing:{state:'live',generation:2,live:true,entries:[{index:0,resources:[{resource:resA,field:'files',methods:{[STORAGE]:['get']},expires_at:2000000000},{resource:resB,field:'files',methods:{[STORAGE]:['get']}}]}]},incoming:{state:'live',generation:1,live:true},peer:{grant:'live',acceptance:'live'},unreachable:{since:Date.UTC(2026,8,1),flagged:true}},
  {principal:beta,handle:'beta',name:'Beta',slot:'recipient',as:'owner',state:'live',outgoing:{state:'suspended',generation:3,live:false,cause:'moved',entries:[{index:0,resources:[{resource:ORIGIN+'/entities/old/resources/z',field:'files',methods:{[STORAGE]:['get']}}]}]},incoming:{state:null,generation:0,live:false},peer:{grant:'live',acceptance:null},hold:{kind:'full',aep:3,cause:'aep-increase',since:Date.UTC(2026,9,20)}}]}],
 invitations:[{invitation:'jti-open',instance,slot:'recipient',as:'owner',invitee:newco,inviteeHandle:'newco',expiresAt:Date.UTC(2026,10,30),createdAt:Date.UTC(2026,9,23)}],
 inbound:{items:[{kind:'invitation',invitation:'jti-in',meta:META,from:zed,fromHandle:'zed',fromName:'Zed',instance:ORIGIN+'/entities/zed/relations/s',relation:supplyPin,slot:'supplier',receivedAt:Date.UTC(2026,9,22),expiresAt:Date.UTC(2026,10,20)}],
  introductions:[{kind:'introduction',introduction:'intro-1',proposer:acme,proposerHandle:'acme',instance,slot:'recipient',candidate:newco,candidateHandle:'newco',receivedAt:Date.UTC(2026,9,22),expiresAt:Date.UTC(2026,10,21)}]},
 holds:{holds:[{counterpart:beta,kind:'full',aep:3,cause:'aep-increase',since:Date.UTC(2026,9,20)}],unreachable:[{counterpart:acme,since:Date.UTC(2026,8,1),flagged:true}]},
 imports:[{grantor:acme,grantorHandle:'acme',grantorName:'Acme',instance,entry:1,status:'available',held:true,resources:[{id:'imp_1',resource:ORIGIN+'/entities/acme/resources/x',contracts:[STORAGE],methods:{[STORAGE]:['put']},status:'available'}]}]});
const memberImports={imports:[{id:'imp_1',grantor:acme,grantorHandle:'acme',grantorName:'Acme',status:'available',contracts:[STORAGE]}]};
const membershipView=powers=>({organization:{id:org,name:'Example',label:'team',state:'active'},membership:{id:'member',grants:[]},powers});

const options=await fetch('/fixture').then(r=>r.json());window.calls=[];window.downloads=[];
const api={captureContext:()=>({owner:'person',sessionContext:'ctx'}),get(path){return this.request(path,undefined,'GET');},async request(path,body,method='POST'){
window.calls.push({path,body,method});
if(path===REL&&method==='GET')return overview();
if(path===REL+'/export')return {version:1,organization:P(org),records:[],next:null};
if(path===REL+'/imports')return memberImports;
if(path===REL+'/resources')return pool;
if(path===REL+'/catalogue')return catalogue;
if(path===REL+'/counterparty')return {counterparty:{...acme,handle:'acme',identity:ORIGIN+'/identity/'+acme.sub,origin:ORIGIN}};
if(path===REL){if(body.operation==='inbound-preview')return disclosure;if(body.operation==='preview')return {matrix,pin,warnings:[]};return {ok:true};}
if(path==='/api/orgs')return {organizations:[{id:org,name:'Example',powers:options.member?[]:['admin']}]};
if(path.endsWith('/membership'))return membershipView(options.member?[]:['admin']);
if(path==='/api/orgs/'+org)return {id:org,name:'Example',state:'active',revision:1};
if(path.endsWith('/ownership'))return {billing:{standing:'paid'},decisions:[]};
return {members:[],requests:[],connections:[],preferences:[],entries:[]};}};
const browser={download:(name,content)=>window.downloads.push({name,content}),focus:selector=>requestAnimationFrame(()=>document.querySelector(selector)?.focus()),secret:()=>null};
const engine=new Engine({providers:{state:State,api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),organizationsConsole:OrganizationsProvider,recoveryFile:Provider.fromSingleton({})}});
await engine.container.use({state:{write:true}},({state})=>state.transition(s=>Object.assign(s,{...initial,locale:options.locale,loading:false})));
const root=document.querySelector('#app'),paint=async()=>{const s=await engine.container.use(['state'],({state})=>state.snapshot());dodo.reconcile(root,[organizations(s)]);};
engine.feed.addEventListener('browser-state-updated',()=>window.painting=(window.painting??Promise.resolve()).then(paint));
root.addEventListener('3sln-intent',e=>{if(e.detail.kind==='organizations')window.pending=engine.dispatch(organizationsAction(e.detail)).next('complete');});
window.act=(action,detail={})=>window.pending=engine.dispatch(new OrganizationsIntent({action,...detail})).next('complete');await paint();window.ready=true;
`;
