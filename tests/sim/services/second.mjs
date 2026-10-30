// Simulation service 'second': the non-3sln clean-room home issuer (tests/helpers/second-issuer.mjs, written from the
// spec, imports no 3sln.me code) served over HTTPS at https://second.example. It answers GET for its manifest, the
// `?sub=` directory lookup and identity documents; certificates are minted in code by the scenario's API actor (it has
// no consent UI). Its origin joins ORG_FOREIGN_ISSUERS only: second.example implements no signaling.
import {secondIssuer} from '../../helpers/second-issuer.mjs';

let issuer=null;
export default {
 name:'second',hosts:['second.example'],
 // ORG_FOREIGN_ISSUERS is set whole here (world.mjs sets both foreign lists from `foreignIssuers`; this provider list
 // must not gain a signaling peer that does not exist).
 providerConfig:p=>({ORG_FOREIGN_ISSUERS:JSON.stringify([...['alpha','beta'].filter(n=>n!==p.name).map(n=>`https://${n}.example`),'https://second.example'])}),
 get issuer(){return issuer;},
 async start(network){
  issuer=await secondIssuer({origin:'https://second.example'});
  await network.serve(['second.example'],async(req,res)=>{
   try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Content-Type':'application/json',Allow:'GET, HEAD'});res.end('{"error":"method_not_allowed"}');return;}
    const answer=await issuer.fetch('https://second.example'+req.url),body=Buffer.from(await answer.arrayBuffer());
    res.writeHead(answer.status,Object.fromEntries(answer.headers));res.end(req.method==='HEAD'?undefined:body);
   }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"server_error"}');}
  });
  return {issuer,describe:()=>({origin:'https://second.example',implementation:'tests/helpers/second-issuer.mjs (clean-room, fetch-shaped; GET only)'})};
 }
};
