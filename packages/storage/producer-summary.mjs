// AU-2 remaining-settings slice. Producer attribution is not collected yet; callers must not infer an empty ledger
// means no app data. Settings belong to the owner and are retained unless explicitly deleted at a reviewed revision.
import {AppAction} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
const fail=(code,message,status=409)=>{throw new AppFault(code,message,status);};
export class DeleteRemovalSettings extends AppAction{
 static operation='app-removal.delete-settings';static deps=['federation'];static changes='app-removal-settings-changed';
 constructor({authority,...options}={}){super(options);this.authority=authority;}
 async run({federation:s}){const v=this.input;if(!v||Object.keys(v).some(k=>!['removeSettings','fragment','expectedRevision'].includes(k))||v.removeSettings!==true||typeof v.fragment!=='string'||typeof v.expectedRevision!=='string')fail('invalid_request','Review the saved settings first.',400);
 const identity=await s.authenticateOwner(this.authority),subject=await s.owner(this.authority);
 return s.store.transaction(async tx=>{const path=`federation/preferences/${subject}|${v.fragment}`,row=await tx.get(path);if(!row)return {deleted:false};if(row.revision!==v.expectedRevision)fail('consent_stale','These settings changed. Review them again.');const consumers=await s.consumerSnapshot(tx,subject,v.fragment,identity.epoch);if(consumers.consumers.length)fail('settings_in_use','Other apps still use these settings. Revoke their access before deleting.');await tx.delete(path);return {deleted:true};});
 }
}
