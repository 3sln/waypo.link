import {Provider} from '../shared/stack.mjs';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
// Thin HTTP port. The person session remains the authentication context; organization
// routing is explicit and never replaces the API's selected account or its CSRF binding.
const READS={list:'',get:'',members:'/members',audit:'/audit',membership:'/membership',requests:'/requests',connections:'/connections',preferences:'/preferences'};
const WRITES={create:'',rename:'/name',label:'/label',invite:'/invitations',accept:'/accept',leave:'/leave',remove:'/remove-member',grants:'/member-grants',decide:'/grant-decision',connection:'/connections',preference:'/preferences'};
export function createOrganizationsPort(){return Object.freeze({
 async call(action,input,{api,org}={}){
  if(org!==undefined&&!uuid.test(org))throw Object.assign(Error('invalid_organization'),{code:'invalid_organization'});
  const root='/api/orgs'+(org===undefined?'':'/'+org);
  if(Object.hasOwn(READS,action))return api.get(root+READS[action]);
  if(action==='cancel-deletion'){if(org===undefined)throw Object.assign(Error('invalid_request'),{code:'invalid_request'});return api.request(root+'/deletion',undefined,'DELETE');}
  if(!Object.hasOwn(WRITES,action))throw Object.assign(Error('invalid_request'),{code:'invalid_request'});
  return api.request(root+WRITES[action],input);
 },
 id:()=>crypto.randomUUID(),passphrase:()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
});}
export default class OrganizationsProvider extends Provider{obtain(){return createOrganizationsPort();}release(){}}
