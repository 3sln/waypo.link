// Scenario part 'accounts' (integration pattern P5, multiple accounts): one person on alpha adds a second alpha account
// in the same browser through the provider console, holds both in Notes, switches between them (each account keeps
// its own notes), and signs out of one account only. Holding an account on another provider in the same app session
// list works through persisted app sessions (W11). Runs last: adding an account changes the provider's current account in that browser.
import {signUp} from '../steps/accounts.mjs';
import * as multi from '../steps/multi-account.mjs';

export const name='accounts';
export const moments=Object.freeze({
 'provider-accounts-one':{title:'Provider: accounts in this browser (before adding one)',surface:'provider',locale:null,localeNote:'the accounts view is a tab state; a reload returns to the console'},
 'provider-entry-two-accounts':{title:'Provider: choose one of two accounts for Notes',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow',element:'signing in (provider chooser, two accounts)'},
 'notes-account-menu-two':{title:'Notes: account menu with two held accounts',surface:'notes',locale:'notes',element:'<bindle-account> panel: other accounts, per-account sign-out'},
 'notes-switched-account':{title:'Notes after switching back to the first account',surface:'notes',locale:'notes',element:'<bindle-account> after bindle-account-select'}
});
const WORK={title:'Team standup — Thursday',body:'Demo the new onboarding flow.\nAsk about the Q4 hiring plan.'};
const PERSONAL={title:'Climbing gym schedule',body:'Tuesday and Friday evenings, bouldering session Sunday morning.'};

export function define(run,world,{alpha}){
 const person=alpha[2];
 run.step('accounts.add-second.alpha',{actor:person.name},ctx=>signUp(ctx,ctx.person(person),world.providers.alpha,{add:true,key:'alpha2',addShots:true}));
 run.step('accounts.signup.beta-extra',{actor:person.name},ctx=>signUp(ctx,ctx.person(person),world.providers.beta,{key:'beta'}));
 run.step('accounts.notes.first',{actor:person.name},ctx=>multi.firstAccount(ctx,ctx.person(person),{work:WORK,shots:true}));
 run.step('accounts.notes.add-account',{actor:person.name},ctx=>multi.addSecondAccount(ctx,ctx.person(person),{personal:PERSONAL,shots:true}));
 run.step('accounts.notes.switch',{actor:person.name},ctx=>multi.switchBack(ctx,ctx.person(person),{work:WORK,shots:true}));
 run.step('accounts.notes.sign-out-one',{actor:person.name},ctx=>multi.signOutOne(ctx,ctx.person(person),{personal:PERSONAL}));
 // W11: the alpha session is persisted, so a redirect sign-in at beta keeps both held. (Controller selectAccount still
 // picks held sessions of the current issuer only; this step does not exercise switching.)
 run.step('accounts.notes.cross-provider-hold',{actor:person.name},ctx=>multi.crossProviderHold(ctx,ctx.person(person)));
}
