// DX-1 export engine domain. DX-2 registers ACCOUNT_EXPORT_OPERATIONS and passes
// trusted read/effect ports through config.exportPorts until the coordinator
// adds their dedicated catalogue rows. No request can supply provider resources.
import {AppAction,AppQuery} from '../engine.mjs';
import {fault} from '../faults.mjs';
import {UUID} from '../../core/primitives.mjs';
import {AccountExport} from '../../runtime/export-generation.mjs';
const deps=['accountStore','archives','blobs','clock','random','flags','config'];
function service(resources){return new AccountExport({...resources,...resources.config.exportPorts});}
function authority(actor,kinds){if(!kinds.includes(actor?.kind)||!UUID.test(actor?.owner??''))fault('unauthorized','Export authority is required.',401);return actor.owner;}
class ExportAction extends AppAction {static deps=deps;static lifecycle='suspended';static termsGate='exempt';static changes='exports-changed';}
class ExportQuery extends AppQuery {static deps=deps;static lifecycle='suspended';static termsGate='exempt';static refreshOn=['exports-changed'];}
export class CreateExport extends ExportAction {static operation='exports.create';run(r){return service(r).create(authority(this.actor,['owner']),this.input,this.actor);}}
export class ExportList extends ExportQuery {static operation='exports.list';fetch(r){return service(r).list(authority(this.actor,['owner']));}}
export class ExportStatus extends ExportQuery {static operation='exports.status';fetch(r){return service(r).status(authority(this.actor,['owner']),this.id);}}
export class CancelExport extends ExportAction {static operation='exports.cancel';static lifecycle='purging';static warm=false;run(r){const owner=authority(this.actor,['owner','system']);return this.actor.kind==='system'&&this.id===undefined?service(r).cancelAll(owner,this.input):service(r).cancel(owner,this.id);}}
export class StepExport extends ExportAction {static operation='exports.step';static gate='none';run(r){return service(r).step(authority(this.actor,['system']));}}
export class ExpireExports extends ExportAction {static operation='exports.expire';static lifecycle='purging';static warm=false;run(r){return service(r).expire(authority(this.actor,['system']));}}
export class ExportLayout extends ExportQuery {static operation='exports.layout';fetch(r){return service(r).layout(authority(this.actor,['owner']),this.id,this.input,this.actor);}} // Wargame 4: grant downloads go only through the token-verifying DownloadExport adapter, never a caller-built actor.
export const ACCOUNT_EXPORT_OPERATIONS=[CreateExport,ExportList,ExportStatus,CancelExport,StepExport,ExportLayout,ExpireExports];
