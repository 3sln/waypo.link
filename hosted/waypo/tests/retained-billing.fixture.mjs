// Trusted retained-subscription metadata ONLY. No new vendor object, intent
// admission, merchant settlement or physical funded-capacity receipt is proved.
export async function seedRetainedBillingFixture(tx,{issuer,subject,subscriptionId}){
 const external='waypo_'+Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(issuer+'\0'+subject))).toString('base64url');
 await tx.put('hosted/polar/bindings-anchor-v1',{v:1,issuer,environment:'sandbox',organizationId:'org'});await tx.put('hosted/polar/bindings-stock-v1',{v:1,count:1});
 await tx.put('hosted/polar/'+external,{v:1,issuer,subject,environment:'sandbox',organizationId:'org',productId:'product',version:0,epoch:0,receipts:[],actions:[],paidThrough:0,trialEnd:0,subscriptionId,completedPaidMonths:[]});return external;
}
