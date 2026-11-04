// Explicit trusted policy adapter only. Importing this enables no delivery.
import {createEmailBudgetEngine} from '@3sln/waypo/engines/email-budget';
export function createHostedEmailBudget({store,clock,cryptography,recipientKey,billingScope,policy}={}){
 // No vendor allowance, inferred prices or application-config defaults.
 return createEmailBudgetEngine({store,clock,cryptography,recipientKey,billingScope,policy});
}
