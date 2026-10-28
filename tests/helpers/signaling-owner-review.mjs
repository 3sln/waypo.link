// Owner-page reviews for tests that set up signaling state through the runtime, where the engine runs with
// `ownerPages` (packages/signaling/owner-pages.mjs): every widening owner action needs a review taken first and is
// refused until the review's server-side arming time. These helpers do what the pages do: one review per action (in
// parallel), one wait past the latest `armAt`, then each action with its review id as adapter evidence.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** `dispatch(operation, input, actor)` over an account writer (object.signalingDispatch); `items`
 * [{operation, action, input, extra?}]. Returns the operations' results in order. */
export async function reviewed(dispatch,actor,items){
 const reviews=await Promise.all(items.map(item=>dispatch('signaling.review',{action:item.action,input:item.input},actor)));
 for(const [i,r] of reviews.entries())if(typeof r?.review!=='string')throw Error(`no review for ${items[i].action}: ${JSON.stringify(r)}`);
 const wait=Math.max(...reviews.map(r=>r.armAt))-Date.now();if(wait>0)await sleep(wait+10);
 const out=[];for(const [i,item] of items.entries())out.push(await dispatch(item.operation,{...reviews[i].input,...item.extra??{}},{...actor,review:reviews[i].review}));
 return out;
}
/** Session handler approvals of `clientId` for `kinds` (lines or {artefact, version, digest}). */
export const approvals=(clientId,kinds,{autoConnect}={})=>kinds.map(kind=>({operation:'intents.session-approve',action:'session-approve',input:{clientId,kind},...autoConnect!==undefined?{extra:{autoConnect}}:{}}));
/** The same over HTTP: `post(path, body)` resolves to {status, body}. Reviews at POST /api/signaling/review, then posts
 * each item's `path` with the reviewed input plus `review`. Returns the {status, body} answers in order. */
export async function reviewedHTTP(post,items){
 const reviews=await Promise.all(items.map(item=>post('/api/signaling/review',{action:item.action,input:item.input})));
 for(const [i,r] of reviews.entries())if(r.status!==200||typeof r.body?.review!=='string')throw Error(`no review for ${items[i].action}: ${r.status} ${JSON.stringify(r.body)}`);
 const wait=Math.max(...reviews.map(r=>r.body.armAt))-Date.now();if(wait>0)await sleep(wait+10);
 const out=[];for(const [i,item] of items.entries())out.push(await post(item.path,{...reviews[i].body.input,...item.extra??{},review:reviews[i].body.review}));
 return out;
}
