export const hostedFixtureSettings={mode:'free',environment:'sandbox',allowedSignupCountries:['US'],accountAdmission:{revision:1,maxPublicAccounts:16,maxProtectedAccounts:8,acceptingNewAccounts:true},accountCreationRate:{revision:1,global:{capacity:64,refillPerMinute:4},public:{capacity:48,refillPerMinute:3},protected:{capacity:16,refillPerMinute:1},protectedReserveUnits:16,blockSize:4,blockMs:60000,maxWorkers:8,protectedWorkerSlots:2}};
export const securityMailBudgetPolicy={revision:'fixture-security-mail-v1',currency:'USD',attemptMicroUSD:1,attemptTtlMs:60000,maxAttempts:64,maxRecipients:64,maxOwners:8,reservedAttempts:16,reservedRecipients:8,reservedOwners:2,daily:{messages:64,microUSD:64,reservedMessages:16,reservedMicroUSD:16},monthly:{messages:64,microUSD:64,reservedMessages:16,reservedMicroUSD:16},fleet:{windowMs:1000,messages:128,reservedMessages:32},recipient:{windowMs:1000,messages:8}};
export function decodeHostedFixtureMail(payload){
 if(typeof payload.text!=='string'||typeof payload.to!=='string')throw Error('Fixed hosted email payload required');
 const urls=payload.text.match(/https:\/\/[^\s]+/g);if(urls?.length!==1)throw Error('Single rendered proof URL required');const url=urls[0],path=new URL(url).pathname;
 const purpose=path==='/email'?'identity-login':path==='/passkeys/approve'?'identity-passkey-addition':path==='/sessions/approve'?'identity-session-security':null,code=/Verification code: (\d{8})\b/u.exec(payload.text)?.[1];
 if(!purpose||!code||payload.from?.email!==(purpose==='identity-login'?'login@login.waypo.link':'account@account.waypo.link'))throw Error('Fixed security/login template required');
 return {to:payload.to,purpose,url,code};
}
export function budgetProjection(state){return {messages:state?.daily?.all?.messages??0,microUSD:state?.daily?.all?.microUSD??0,attemptRows:Object.keys(state?.attempts??{}).length};}
