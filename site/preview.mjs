import {createServer} from 'node:http';
import {documentationResponse} from '../hosted/waypo/documentation.mjs';
const port=Number(process.env.PORT??9417);
createServer(async(req,res)=>{const request=new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method});const response=documentationResponse(request)??new Response('Local documentation preview. Open /docs.',{headers:{'Content-Type':'text/plain'}});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}).listen(port,'127.0.0.1',()=>console.log(`Local documentation preview: http://127.0.0.1:${port}/docs`));
