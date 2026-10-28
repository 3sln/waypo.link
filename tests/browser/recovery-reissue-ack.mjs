// Console flow (apps/web/src/bl/recovery-reissue.mjs, ui/recovery-reissue.mjs) for recovery file v3 (owner approval
// 2026-10-28): the download acknowledgement is a re-upload of the saved file, compared by SHA-256 with the encrypted
// bytes this browser offered for download (never decrypted, never sent); confirmation needs it; the local check-up
// compares the picked file's id with the console's current id without any server call; the annual reminder banner.
// Engine-level with stub ports and happy-dom, en and es; run with the browser loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {recoveryFileDigest} from '../../packages/recovery/index.mjs';
const window=new Window({url:'https://space.example'});
for(const key of ['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'])globalThis[key]=window[key];
const {dodo}=await import('../../apps/web/src/shared/stack.mjs');
const {recoveryFilePanel,recoveryReissueView,recoveryCheckView,recoveryReissueDialog}=await import('../../apps/web/src/ui/recovery-reissue.mjs');
const bl=await import('../../apps/web/src/bl/recovery-reissue.mjs');
const {catalogues}=await import('../../packages/i18n/catalogues.mjs');
function render(view){const root=document.createElement('div');dodo.reconcile(root,[view]);return root;}
test.after(()=>window.happyDOM.close());

const ORIGIN='https://space.example',ID='0f8e6a52-3c1b-4d7e-9a2f-5b6c7d8e9f01',FILE_ID='ICEiIyQlJicoKSorLC0uLw',OLD_ID='AAAAAAAAAAAAAAAAAAAAAA';
const TOKEN=`${ID}.${'A'.repeat(43)}`,payload={version:3,issuer:ORIGIN,entity:ID,recoveryToken:TOKEN,fileId:FILE_ID,issuedAt:1};
const fileOf=text=>({size:new TextEncoder().encode(text).length,arrayBuffer:async()=>new TextEncoder().encode(text).buffer,text:async()=>text});

/** A console world: state, secrets, calls, a stub recovery-file provider whose digest is the real one. */
function world(extra={}){
 const secrets=new Map(),calls=[],downloads=[];
 let state={locale:'en',config:{origin:ORIGIN},busy:false,notice:'',error:'',session:{account:{id:ID}},data:{account:{id:ID},recovery:{fileId:OLD_ID,issuedAt:1,reissueAvailable:true}},...extra};
 const encrypted={format:'3sln-recovery',version:2,fileId:FILE_ID,normalization:'3sln-answers-v1',questions:[{id:'q',type:'passphrase',prompt:'P',hint:''}],kdf:{},cipher:{},ciphertext:'x'};
 const resources={
  state:{snapshot:()=>state,peek:()=>state,transition:fn=>{const next={...state};state=fn(next)??next;},reserve:()=>!state.busy&&(state={...state,busy:true},true)},
  api:{request:async(path,body)=>{calls.push([path,body]);if(path.endsWith('/begin'))return {fileName:`3sln-recovery-${ID}.json`,content:JSON.stringify(payload),recoveryToken:TOKEN,fileId:FILE_ID,expiresAt:5,transferPending:false,forced:null};if(path.endsWith('/confirm'))return {reissued:true,transferCancelled:false};return {};},get:async path=>{calls.push([path]);return {account:{id:ID},recovery:{fileId:FILE_ID}};}},
  browser:{secret:k=>secrets.get(k),storeSecret:(k,v)=>v===null?secrets.delete(k):secrets.set(k,v),id:()=>'q',focus(){},download:(name,text)=>downloads.push([name,text]),consumeSubmission:()=>({})},
  recoveryFile:{encrypt:async()=>structuredClone(encrypted),decrypt:async()=>structuredClone(payload),digest:input=>typeof input==='string'?recoveryFileDigest(input):input.arrayBuffer().then(recoveryFileDigest),inspect:async file=>({text:await file.text(),header:JSON.parse(await file.text())})},
 };
 const run=async(Action,values={})=>{const before=state.error;state={...state,error:''};await new Action({values}).execute(resources,{engineFeed:new EventTarget()});return state.error||null;};
 return {get state(){return state;},set state(v){state=v;},secrets,calls,downloads,run,resources};
}

test('re-upload acknowledgement: only the exact downloaded bytes unlock confirmation; nothing is decrypted or sent until then', async () => {
 const w=world();
 assert.equal(await w.run(bl.BeginRecoveryReissue,{acknowledged:'on'}),null);
 assert.equal(bl.reissueState(w.state).stage,'questions');
 assert.equal(await w.run(bl.EncryptRecoveryReissue,{'answer:q':'secret phrase'}),null);
 assert.equal(bl.reissueState(w.state).stage,'download');
 const offered=w.secrets.get('reissueEncrypted');assert.equal(w.secrets.get('reissueDigest'),await recoveryFileDigest(offered));
 assert.equal(await w.run(bl.DownloadRecoveryReissue),null);assert.deepEqual(w.downloads,[[`3sln-recovery-${ID}.json`,offered]]);
 // Confirmation is refused before the saved file was selected again.
 w.state={...w.state,reissue:{...w.state.reissue,stage:'confirm'}};
 assert.match(await w.run(bl.ConfirmRecoveryReissue,{confirmed:'on'}),/select it again/);
 w.state={...w.state,reissue:{...w.state.reissue,stage:'verify'}};
 assert.equal(await w.run(bl.VerifyRecoveryReissue,{'verify:q':'secret phrase'}),null);
 assert.equal(bl.reissueState(w.state).stage,'upload');
 const decrypts=[];w.resources.recoveryFile.decrypt=async(...args)=>{decrypts.push(args);return payload;};
 // A different file (edited, older, re-encrypted) is refused and the flow stays on this step.
 for(const other of [offered.replace('"version": 2','"version":  2'),offered+'\n',JSON.stringify(JSON.parse(offered))]){
  assert.match(await w.run(bl.CheckRecoveryReissueUpload,{file:fileOf(other)}),/not the file you just downloaded/);
  assert.equal(bl.reissueState(w.state).stage,'upload');assert.equal(w.state.recoveryUploaded,false);
 }
 assert.match(await w.run(bl.CheckRecoveryReissueUpload,{}),/Choose the new recovery file/);
 assert.equal(await w.run(bl.CheckRecoveryReissueUpload,{file:fileOf(offered)}),null);
 assert.equal(bl.reissueState(w.state).stage,'confirm');assert.equal(w.state.recoveryUploaded,true);
 assert.deepEqual(decrypts,[],'the re-uploaded file is never decrypted');
 assert.equal(w.calls.filter(([path])=>path.endsWith('/confirm')).length,0,'nothing was sent for the acknowledgement');
 assert.match(await w.run(bl.ConfirmRecoveryReissue,{}),/Confirm that you saved/);
 assert.equal(await w.run(bl.ConfirmRecoveryReissue,{confirmed:'on'}),null);
 assert.deepEqual(w.calls.find(([path])=>path.endsWith('/confirm')),['/api/auth/recovery/reissue/confirm',{recoveryToken:TOKEN,fileId:FILE_ID,downloadConfirmed:true}]);
 assert.equal(bl.reissueState(w.state).stage,'done');
 for(const key of ['reissue','reissueEncrypted','reissueDigest'])assert.equal(w.secrets.has(key),false,`${key} is forgotten`);
 assert.equal(JSON.stringify(w.state).includes(TOKEN),false,'the credential never reaches the UI projection');
});

test('leaving before confirmation sends nothing; the current file keeps working', async () => {
 const w=world();await w.run(bl.BeginRecoveryReissue,{acknowledged:'on'});await w.run(bl.EncryptRecoveryReissue,{'answer:q':'p'});
 const before=w.calls.length;await w.run(bl.CloseRecoveryReissue);
 assert.equal(w.calls.length,before);assert.equal(bl.reissueState(w.state),null);assert.match(w.state.notice,/Nothing changed/);
 assert.equal(w.secrets.size,0);
});

test('the upload and confirm views (en and es source strings are catalogued)', () => {
 for(const locale of ['en','es']){
  const upload=render(recoveryReissueView({locale,config:{},reissue:{stage:'upload'},downloaded:true,recoveryVerified:true}));
  assert.ok(upload.querySelector('input[type=file][name=file]'));assert.match(upload.textContent,/not decrypted or sent anywhere/);
  const confirm=render(recoveryReissueView({locale,config:{},reissue:{stage:'confirm'},downloaded:true,recoveryVerified:true,recoveryUploaded:false}));
  assert.equal(confirm.querySelector('input[name=confirmed]').disabled,true,'confirmation stays disabled until the saved file matched');
  const ready=render(recoveryReissueView({locale,config:{},reissue:{stage:'confirm'},downloaded:true,recoveryVerified:true,recoveryUploaded:true}));
  assert.equal(ready.querySelector('input[name=confirmed]').disabled,false);assert.match(ready.textContent,/second copy/);
 }
 for(const key of ['Select the file you saved.','Choose the new recovery file from where you saved it. This device checks that it is exactly the file you downloaded. It is not decrypted or sent anywhere.','Check the saved file','New recovery file','SAVED FILE CHECKED','ANSWERS TESTED','Keep a second copy somewhere other than this device. We cannot check that for you.','This is not the file you just downloaded. Choose the new recovery file you saved on this device.','Download your new recovery file, test it and select it again before replacing the old one.']){
  assert.ok(catalogues.en[''][key]&&catalogues.es[''][key],key);assert.notEqual(catalogues.es[''][key],key);
 }
});

test('local check-up: header id first (no key derivation for another file), then a local unlock; never a server call', async () => {
 const current=JSON.stringify({fileId:OLD_ID,questions:[{id:'q',type:'passphrase',prompt:'P',hint:''}]});
 const w=world({data:{account:{id:ID},recovery:{fileId:OLD_ID,issuedAt:1,pendingReissue:{previousFileId:'BBBBBBBBBBBBBBBBBBBBBA'}}}});
 const calls=[];w.resources.api.request=async(...args)=>{calls.push(args);return {};};w.resources.api.get=async(...args)=>{calls.push(args);return {};};
 let decrypts=0;w.resources.recoveryFile.decrypt=async()=>{decrypts++;return {...payload,fileId:OLD_ID};};
 await w.run(bl.OpenRecoveryCheck);assert.equal(bl.recoveryCheckState(w.state).stage,'select');
 assert.equal(await w.run(bl.InspectRecoveryCheck,{file:fileOf(JSON.stringify({fileId:'CCCCCCCCCCCCCCCCCCCCCA',questions:[]}))}),null);
 assert.equal(bl.recoveryCheckState(w.state).stage,'stale');assert.equal(decrypts,0);
 await w.run(bl.CloseRecoveryCheck);await w.run(bl.OpenRecoveryCheck);
 await w.run(bl.InspectRecoveryCheck,{file:fileOf(JSON.stringify({fileId:'BBBBBBBBBBBBBBBBBBBBBA',questions:[]}))});
 assert.equal(bl.recoveryCheckState(w.state).stage,'previous');
 await w.run(bl.CloseRecoveryCheck);await w.run(bl.OpenRecoveryCheck);
 await w.run(bl.InspectRecoveryCheck,{file:fileOf(current)});
 assert.equal(bl.recoveryCheckState(w.state).stage,'answers');assert.deepEqual(w.state.unlockQuestions.map(q=>q.id),['q']);
 // Wrong answers keep the owner here.
 w.resources.recoveryFile.decrypt=async()=>{decrypts++;throw new Error('The file could not be decrypted. Check every answer and the recovery file.');};
 assert.match(await w.run(bl.UnlockRecoveryCheck,{'check:q':'wrong'}),/could not be decrypted/);assert.equal(bl.recoveryCheckState(w.state).stage,'answers');
 w.resources.recoveryFile.decrypt=async()=>{decrypts++;return {...payload,fileId:OLD_ID};};
 assert.equal(await w.run(bl.UnlockRecoveryCheck,{'check:q':'right'}),null);
 assert.equal(bl.recoveryCheckState(w.state).stage,'ok');assert.equal(w.secrets.has('recoveryCheckFile'),false);
 assert.deepEqual(calls,[],'the check-up never calls the server');
 await w.run(bl.CloseRecoveryCheck);assert.equal(bl.recoveryCheckState(w.state),null);
});

test('check-up and reminder views render in en and es, and their strings are catalogued', () => {
 for(const locale of ['en','es']){
  for(const stage of ['select','answers','ok','previous','stale']){const root=render(recoveryCheckView({locale,config:{},recoveryCheck:{stage},unlockQuestions:[{id:'q',type:'passphrase',prompt:'P',hint:''}]}));assert.ok(root.querySelector('.recovery-check'),stage);}
  const panel=render(recoveryFilePanel({locale,config:{},data:{recovery:{fileId:FILE_ID,issuedAt:1,reissueAvailable:true,reminder:{stage:'due',slot:1,anniversaryAt:2,nextAt:3}}}}));
  assert.ok(panel.querySelector('.recovery-reminder[role=status]'));assert.match(panel.textContent,/Nothing stops working/);assert.match(panel.textContent,new RegExp(FILE_ID));
  assert.ok([...panel.querySelectorAll('button')].some(b=>b.textContent==='Check my recovery file'));
  const quiet=render(recoveryFilePanel({locale,config:{},data:{recovery:{fileId:FILE_ID,issuedAt:1,reissueAvailable:true,reminder:{stage:'none'}}}}));assert.equal(quiet.querySelector('.recovery-reminder'),null);
  const legacy=render(recoveryFilePanel({locale,config:{},data:{recovery:{fileId:null,issuedAt:null,reissueAvailable:true,reissueRequired:'legacy-format'}}}));assert.match(legacy.textContent,/older format/);
 }
 for(const key of ['Check my recovery file','Time for a new recovery file?','Nothing stops working. Your current file keeps working until you confirm a new one.','Your recovery file is more than a year old. We suggest creating a new one each year.','Your recovery file will be a year old on {date}. We suggest creating a new one each year.','Your recovery file uses an older format that no longer works. Create a new one now.','File ID','Check your recovery file.','This is not your current recovery file.','This is your previous recovery file.','Your recovery file is current and opens with your answers.','Choose your recovery file and enter your answers. This device checks that the file opens and that it is your current file. Nothing is sent.']){
  assert.ok(catalogues.en[''][key]&&catalogues.es[''][key],key);assert.notEqual(catalogues.es[''][key],key);
 }
});

test('review L2: the check-up names what the previous file can do, from previousFileCanCancel; review L1: the dialog promises no move authority', () => {
 const LOCKED='It was replaced recently with a passkey confirmation, so it cannot cancel the replacement, and it stops working when the 7-day waiting period ends. To cancel, use a device that was signed in before the replacement started or the link in the email notice.';
 const OPEN='It was replaced recently. During the 7-day waiting period it can only cancel the replacement; after that it stops working.';
 // The views emit source text (the catalogue key); translation happens at the interface layer, so the catalogue is checked below.
 for(const locale of ['en','es']){
  const view=canCancel=>render(recoveryCheckView({locale,config:{},recoveryCheck:{stage:'previous'},data:{recovery:{fileId:FILE_ID,pendingReissue:{previousFileId:OLD_ID,previousFileCanCancel:canCancel}}}})).textContent;
  const locked=view(false),open=view(true);
  assert.ok(locked.includes(LOCKED),locale);assert.ok(!locked.includes(OPEN),'a passkey-confirmed replacement is never said to be cancellable by the old file');
  assert.ok(open.includes(OPEN),locale);assert.ok(!open.includes(LOCKED));
  for(const recovery of [{fileId:FILE_ID,reissueAvailable:true},{fileId:null,reissueRequired:'legacy-format'}]){const dialog=recoveryReissueDialog({locale,config:{},data:{recovery}});const text=render(dialog.body).textContent;assert.doesNotMatch(text,/moving your identity|mudanza de tu identidad/,locale);}
 }
 assert.ok(catalogues.en[''][LOCKED]&&catalogues.es[''][LOCKED]);assert.notEqual(catalogues.es[''][LOCKED],LOCKED);
 assert.equal(catalogues.en['']['The new file can authorize moving your identity only after 7 days.'],undefined);
});
