// Only external acceptance is synthetic. The budget ledger and sender adapter
// are the actual portable policy + durable Node SQL / Worker DO implementation.
import {join} from 'node:path';
import {appendFile} from 'node:fs/promises';
import {provisionNodeInstallation,openNodeSqliteStore} from '@3sln/waypo/adapters/node/sqlite';
import {createHostedEmailBudget} from '../email-budget.mjs';
import {createHostedEmailBudgetAdmission,readEmailBudgetConfiguration,emailBudgetConfigurationFingerprint} from '../email-budget-binding.mjs';
import {createHostedEmailBinding} from '../email-binding.mjs';
import {hostedFixtureSettings,securityMailBudgetPolicy,decodeHostedFixtureMail,budgetProjection} from './security-mail-profile.fixture.mjs';
export {hostedFixtureSettings,securityMailBudgetPolicy,decodeHostedFixtureMail,budgetProjection};
export async function createNodeHostedSecurityMailFixture({directory,configuration,mailbox,beforeSend=()=>{}}){
 const filename=join(directory,'budget.sqlite');await provisionNodeInstallation({filename,installationId:'hosted-security-mail-budget'});const store=openNodeSqliteStore({filename});
 const env={HOSTED_EMAIL_BUDGET_CONFIG:JSON.stringify({billingScope:'security-mail-ui-fixture',policy:securityMailBudgetPolicy,gcIntervalMs:1000}),HOSTED_EMAIL_BUDGET_KEY:configuration.authSecret};
 const selected=readEmailBudgetConfiguration(env),fingerprint=await emailBudgetConfigurationFingerprint(selected),budget=await createHostedEmailBudget({store,...selected});
 env.EMAIL_BUDGET={idFromName:n=>n,get:()=>({async fetch(request){if(request.headers.get('x-waypo-email-budget-config')!==fingerprint)return new Response(null,{status:503});const input=await request.json();try{return Response.json(await budget.chargeAttempt({attemptId:input.attemptId,purpose:input.purpose,recipient:input.to}));}catch{return new Response(null,{status:503});}}})};
 const transport=createHostedEmailBinding({configuration,emailBinding:{async send(payload){beforeSend();await appendFile(mailbox,JSON.stringify(decodeHostedFixtureMail(payload))+'\n',{mode:0o600});return {messageId:'synthetic-email-accepted'};}},requireEmailBudget:true,beforeEmailAttempt:createHostedEmailBudgetAdmission(env)});
 const scope=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('email-billing-scope\0security-mail-ui-fixture'))).toString('base64url');
 return {transport,async exhaust(){for(let i=0;i<65;i++){try{await budget.chargeAttempt({attemptId:Date.now()+'.'+crypto.randomUUID().replaceAll('-',''),purpose:'identity-session-security',recipient:'drain-'+i+'@fixture.example'});}catch{break;}}},snapshot:()=>store.transaction(async tx=>budgetProjection(await tx.get('email-budget/v1/'+scope))),async close(){await budget.close();await store.close();}};
}
