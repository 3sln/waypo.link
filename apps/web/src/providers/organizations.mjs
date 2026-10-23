import {Provider} from '../shared/stack.mjs';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
// Thin HTTP port. The person session remains the authentication context; organization
// routing is explicit and never replaces the API's selected account or its CSRF binding.
export function createOrganizationsPort(){return Object.freeze({
 async call(action,input,{api,org}={}){if(org!==undefined&&!uuid.test(org))throw Object.assign(Error('invalid_organization'),{code:'invalid_organization'});const root='/api/orgs'+(org===undefined?'':'/'+org),get=action==='list'||action==='get'||action==='members'||action==='audit',suffix={list:'',get:'',create:'',rename:'/name',label:'/label',invite:'/invitations',accept:'/accept',leave:'/leave',remove:'/remove-member',grants:'/member-grants',decide:'/grant-decision',members:'/members',audit:'/audit'}[action];if(suffix===undefined)throw Object.assign(Error('invalid_request'),{code:'invalid_request'});return get?api.get(root+suffix):api.request(root+suffix,input);},
 id:()=>crypto.randomUUID(),passphrase:()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
});}
export default class OrganizationsProvider extends Provider{obtain(){return createOrganizationsPort();}release(){}}
