// Brokered severance rows (integrations §7.2 step 1), shared by the brokered records domain (packages/federation/
// brokered.mjs) and the connections domain's provider-feature grants (packages/apps/connections.mjs), which revoke a
// feature's brokered credentials when the owner disables it, it is suspended past 30 days, it is blocked, or its
// approved resources change (extensions §4.2). Rows commit with the change and are never refused: past the bound, rows
// collapse into one `overflow` row per connection, which X8 treats as revoking every grant of that connection.
export const SEVER='integrations/severance/',SEVER_META='integrations/meta',SEVERANCE_LIMIT=1024;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const pad=n=>String(n).padStart(16,'0');
export async function severanceMeta(t){const m=await t.get(SEVER_META);return plain(m)&&Number.isSafeInteger(m.seq)?m:{seq:0,low:0,health:{},hints:{}};}
/** Appends severance rows inside the caller's transaction `t` ({get, put}). `rows`: [{type, connection, generation,
 * resource, grants}]; rows without grants (other than `detached`) are dropped. */
export async function appendSeverance(t,rows,{clock=()=>Date.now(),limit=SEVERANCE_LIMIT}={}){
 rows=rows.filter(r=>r.grants.length||r.type==='detached');if(!rows.length)return;const m=await severanceMeta(t),at=clock();
 for(const row of rows){m.seq++;if(m.seq-m.low>limit)await t.put(SEVER+'~'+row.connection,{seq:m.seq,at,type:'overflow',connection:row.connection,generation:row.generation,grants:[]});else await t.put(SEVER+pad(m.seq),{seq:m.seq,at,...row});}
 await t.put(SEVER_META,m);
}
