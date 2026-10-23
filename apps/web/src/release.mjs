import {organizationEntry} from './bl/org-entry.mjs';
import {OrganizationsIntent} from './bl/organizations.mjs';
import OrganizationsProvider from './providers/organizations.mjs';
import {organizationsAction,withOrganizationsSurface} from './ui/org-console.mjs';
import {AppRemovalIntent} from './bl/app-removal.mjs';
import {AccountDataAction,AccountDataView,AccountDataFlags,accountDataCurrent,closureSession,bindAccountDataAPI} from './bl/account-data.mjs';
import {withAccountDataSurface} from './ui/account-data.mjs';
import {AcceptTerms,termsPending} from './bl/legal.mjs';
import {Provider} from './shared/stack.mjs';
import {getDomain} from '/vendor/tldts/index.js';
import {createConnectionsPort} from './bl/connections-port.mjs';
import {ConnectionsIntent} from './bl/connections.mjs';
import {connectionsAction} from './ui/connections/index.mjs';
import {AccessAction,accessRoute,accessProjection} from './bl/access.mjs';
import {createAccessCatalog} from './bl/access-provider.mjs';
import {ConfirmOwner,CancelOwnerConfirmation} from './bl/step-up.mjs';
import * as accountActions from './bl/accounts.mjs';
import MessageActionsProvider from './providers/message-actions.mjs';
import * as messageActions from './bl/message-actions.mjs';
import * as incomingActions from './bl/incoming.mjs';
import * as contactLinkActions from './bl/contact-link.mjs';
import * as contactLinksActions from './bl/contact-links.mjs';
import * as googleDriveActions from './bl/google-drive.mjs';
import * as identityActions from './bl/identity.mjs';
import {RECOVERY_REISSUE_INTENTS} from './bl/recovery-reissue.mjs';
import * as conversationActions from './bl/conversations.mjs';
import * as mcpActions from './bl/mcp.mjs';
import * as automationActions from './bl/automation.mjs';
import AutomationProvider from './providers/automation.mjs';
import {Engine,dodo,watch,queryCell} from './shared/stack.mjs';
import BeamingProvider from './providers/beaming.mjs';
import * as beamActions from './bl/beaming.mjs';
import APIProvider from './providers/api.mjs';
import BrowserProvider,{isTextInputTarget} from './providers/browser.mjs';
import RecoveryFileProvider from './providers/recovery-file.mjs';
import PortalAccessProvider from './providers/portal-access.mjs';
import {portalContributionsProvider,composePortalViews,RunPortalCommand,compileKeybindings,resolveKeybinding,normalizeKeyStroke,portalContext} from '/packages/portal/index.mjs';
import {builtInModules,defaultKeybindings} from './shared/portal-modules.mjs';
import {createLocalization,catalogueForContributions} from './shared/i18n.mjs';
import localizeTree from './ui/localize.mjs';
import BrowserStateProvider from './providers/browser-state.mjs';
import * as actions from './bl/release.mjs';
import {ReactivateAccount} from './bl/lifecycle.mjs';
import createApp from './ui/release-app.mjs';

// Composition is the only layer naming concrete browser resources and domain
// Actions. Components receive the Query projection and bubble native intents.
const root=document.getElementById('app');
const consolePort=createConnectionsPort({owner:(input,{api})=>api.request('/api/connections/owner',input),setup:(input,{api})=>api.request('/api/connections/setup',input),saveSetup:(input,{api})=>api.request('/api/connections/setup',{...input,action:'save'}),external:(input,{api})=>api.request('/api/connections/client-metadata',input),offerings:[{id:'classifier',name:'3sln.me classifier',manifest:{v:1}},{id:'google-drive',name:'Google Drive',manifest:{v:1}}]});
const engine=new Engine({providers:{organizationsConsole:OrganizationsProvider,accountDataFlags:AccountDataFlags,connectionsConsole:Provider.fromSingleton(consolePort),accessCatalog:Provider.fromSingleton(createAccessCatalog({registrableDomain:host=>getDomain(host,{allowPrivateDomains:true}),transition:({operation,connection,expectedGeneration,api,owner})=>consolePort.owner({operation:'connections.'+operation,input:{connection,expectedGeneration}},{api,owner})})),messageActions:MessageActionsProvider,automation:AutomationProvider,beaming:BeamingProvider,api:APIProvider,browser:BrowserProvider,state:BrowserStateProvider,portalContributions:portalContributionsProvider(builtInModules),portalAccess:PortalAccessProvider,recoveryFile:RecoveryFileProvider}});
const registry=await engine.container.use(['portalContributions'],({portalContributions})=>portalContributions);
// Registry data is immutable; this read composes UI factories once per locale.
const surfaces=Object.fromEntries(['en','es'].map(locale=>{const localization=createLocalization({locale,catalogue:catalogueForContributions(registry.list('translations'),locale)}),localize=tree=>localizeTree(tree,localization),views=composePortalViews(registry,{t:localization.t,number:localization.number,date:localization.date,localize});return [locale,withOrganizationsSurface(withAccountDataSurface(createApp({views,localize}),localize))];}));
const cancelRecovery=await engine.container.use(['recoveryFile'],({recoveryFile})=>recoveryFile.cancel);
const cancelDeviceEntry=await engine.container.use(['browser'],({browser})=>browser.cancelDeviceEntry);
const readSignupCaptcha=await engine.container.use(['browser'],({browser})=>browser.captcha);
const pauseSetup=await engine.container.use(['browser'],({browser})=>browser.pauseSetup);
const captureSubmission=await engine.container.use(['browser'],({browser})=>browser.captureSubmission);
const readModel=await engine.container.use(['state'],({state})=>state.snapshot);
const orgEntry=organizationEntry(location);let orgEntryOpened=false;engine.feed.addEventListener('browser-state-updated',()=>{const s=readModel();if(orgEntry&&!orgEntryOpened&&!s.loading&&s.session?.account&&s.data&&!s.busy){orgEntryOpened=true;engine.dispatch(new OrganizationsIntent({action:'entry',...orgEntry}));}});
await engine.container.use(['api'],({api})=>bindAccountDataAPI(api));
const messageFrameResource=await engine.container.use(['messageActions'],({messageActions})=>messageActions);
const prepareBeamDestination=await engine.container.use(['beaming'],({beaming})=>beaming.prepareDestination);
const constructors={
 'accept-terms':AcceptTerms,
 'confirm-owner':ConfirmOwner,'cancel-owner-confirmation':CancelOwnerConfirmation,
 'open-accounts':accountActions.OpenAccounts,'close-accounts':accountActions.CloseAccounts,'add-account':accountActions.AddAccount,'switch-account':accountActions.SwitchAccount,'logout-account':accountActions.LogoutAccounts,'logout-all-accounts':accountActions.LogoutAccounts,'retry-account-cleanup':accountActions.RetryAccountCleanup,
 'message-submission-unknown':messageActions.MessageSubmissionUnknown,'review-message-action':messageActions.ReviewMessageAction,'submit-message-action':messageActions.SubmitMessageAction,'load-message-revision':messageActions.LoadMessageRevision,
 'load-developer-contact':incomingActions.LoadDeveloperContact,'contact-auth':contactLinkActions.ContactAuth,'contact-handoff':contactLinkActions.ContactHandoff,'discover-provider':contactLinkActions.DiscoverProvider,'continue-with-provider':contactLinkActions.ContinueWithProvider,'choose-handoff':contactLinkActions.ChooseHandoff,'proceed-handoff':contactLinkActions.ProceedHandoff,'cancel-handoff':contactLinkActions.CancelHandoff,'write-another':contactLinkActions.WriteAnother,'reload-contact':contactLinkActions.ReloadContact,'reload-contact-page':contactLinkActions.ReloadContactPage,'continue-as-audience':contactLinkActions.ContinueAsAudience,'send-authored-message':contactLinkActions.SendAuthoredMessage,'open-intake':contactLinksActions.OpenIntake,'save-intake':contactLinksActions.SaveIntake,'rotate-challenge':contactLinksActions.RotateChallenge,'restore-default-rule':contactLinksActions.RestoreDefaultRule,'save-tag-label':contactLinksActions.SaveTagLabel,'create-contact':contactLinksActions.CreateContactLink,'open-developer-contact':incomingActions.OpenDeveloperContact,'copy-developer-contact':incomingActions.CopyDeveloperContact,
 'select-view':incomingActions.SelectView,'load-incoming':incomingActions.LoadIncoming,'save-view':incomingActions.SaveView,'delete-view':incomingActions.DeleteView,'organize-incoming':incomingActions.OrganizeIncoming,'update-incoming':incomingActions.UpdateIncoming,
 'claim-handle':identityActions.ClaimHandle,'download-name-certificate':identityActions.DownloadNameCertificate,...RECOVERY_REISSUE_INTENTS,
 'start-google-drive':googleDriveActions.StartGoogleDrive,
 'clear-automation-review':automationActions.ClearAutomationReview,'load-automation':automationActions.LoadAutomation,'enable-automation':automationActions.EnableAutomation,'disable-automation':automationActions.DisableAutomation,'confirm-automation':automationActions.ConfirmAutomation,
 'load-mcp-request':mcpActions.LoadMCPRequest,'decide-mcp':mcpActions.DecideMCP,'load-mcp-grants':mcpActions.LoadMCPGrants,'revoke-bindle-grant':mcpActions.RevokeBindleGrant,'revoke-mcp-grant':mcpActions.RevokeMCPGrant,'disconnect-app':mcpActions.DisconnectApp,'set-app-notifications':mcpActions.SetAppNotifications,
 'load-conversations':conversationActions.LoadConversations,'open-conversation':conversationActions.OpenConversation,'create-conversation':conversationActions.CreateConversation,'conversation-action':conversationActions.ConversationAction,'conversation-reply':conversationActions.ConversationReply,'copy-conversation-access':conversationActions.CopyConversationAccess,
 'select-beam-file':beamActions.SelectBeamFiles,'decline-beam-file':beamActions.SelectBeamFiles,'remove-saved-contact':beamActions.RemoveSavedContact,'copy-saved-contact':beamActions.CopySavedContact,'load-beaming':beamActions.LoadBeaming,'stage-beam-files':beamActions.StageBeamFiles,'send-beam':beamActions.SendBeam,'accept-beam':beamActions.AcceptBeam,'reject-beam':beamActions.RejectBeam,'cancel-beam':beamActions.RejectBeam,'rename-device':beamActions.RenameDevice,'redeem-contact':beamActions.RedeemContact,'update-beam-grant':beamActions.UpdateBeamGrant,'save-profile':beamActions.SaveProfile,'create-beam-invite':beamActions.CreateBeamInvite,'redeem-beam-invite':beamActions.RedeemBeamInvite,'write-beam-nfc':beamActions.WriteBeamNFC,
  signup:actions.SignUp,signin:actions.SignIn,signout:actions.SignOut,
  'start-recovery':actions.StartRecovery,'inspect-recovery':actions.InspectRecovery,
  'recover-account':actions.RecoverAccount,'encrypt-recovery':actions.EncryptRecovery,
  'verify-recovery':actions.VerifyRecovery,
  'add-recovery-question':actions.EditRecoveryQuestion,'remove-recovery-question':actions.EditRecoveryQuestion,
  'move-recovery-question':actions.EditRecoveryQuestion,'edit-recovery-question':actions.EditRecoveryQuestion,'set-pending-passkey':actions.SetPendingPasskey,
  'set-pending-password':actions.SetPendingPassword,'prepare-recovery':actions.PrepareRecovery,
  'signup-channel':actions.ChooseSignupChannel,'signup-next':actions.SignupNext,'signup-back':actions.SignupBack,'setup-contact-mode':actions.SetupContactMode,'recheck-setup-contact':actions.RecheckSetupContact,'start-setup-email':actions.StartSetupEmail,'confirm-setup-email':actions.ConfirmSetupEmail,'start-setup-push':actions.StartSetupPush,'setup-push-proof':actions.ConfirmSetupPush,
  'download-recovery':actions.DownloadRecovery,'confirm-recovery':actions.ConfirmRecovery,
  'email-signin':actions.RequestEmailSignIn,'confirm-email':actions.ConfirmEmail,
  unsubscribe:actions.UnsubscribeChannel,
  'load-account':actions.LoadAccount,'recheck-session':actions.RecheckSession,
  'read-message':actions.ReadMessage,'update-message':actions.UpdateMessage,
  'organize-message':actions.OrganizeMessage,'create-collection':actions.CreateCollection,
  'share-contact':actions.ShareContact,
  'copy-contact-link':actions.CopyContactLink,'save-contact-link':actions.SaveContactLink,
  'revoke-contact':actions.RevokeContact,'quarantine-contact':actions.QuarantineContact,
  'load-signup-plans':actions.LoadSignupPlans,'signup-currency':actions.LoadSignupPlans,'signup-plan':actions.ChooseSignupPlan,'bootstrap-input-mode':actions.NavigateSpace,'signup-checkout':actions.StartSignupCheckout,'open-signup-checkout':actions.OpenSignupCheckout,'recheck-signup-payment':actions.RecheckSignupPayment,
  'request-waitlist':actions.RequestWaitlist,'confirm-waitlist':actions.ConfirmWaitlist,'leave-waitlist':actions.LeaveWaitlist,'copy-waitlist-withdrawal':actions.CopyWaitlistWithdrawal,
  'create-rule':actions.CreateRule,'toggle-rule':actions.ToggleRule,'delete-rule':actions.DeleteRule,
  'save-resource':actions.SaveResource,'verify-resource':actions.VerifyResource,
  'disconnect-resource':actions.DisconnectResource,'save-notifications':actions.SaveNotifications,
  'disable-notifications':actions.DisableNotifications,'remove-push-device':actions.RemovePushDevice,
  'link-email':actions.LinkEmail,'revoke-grant':actions.RevokeGrant,
  'add-passkey':actions.AddPasskey,'remove-passkey':actions.RemovePasskey,
  'revoke-device':actions.RevokeDevice,'revoke-other-devices':actions.RevokeOtherDevices,
  'select-device-kind':actions.SelectDeviceKind,'start-device':actions.StartDeviceLogin,'device-proof-ready':actions.PrepareDeviceQR,'accept-device':actions.AcceptDeviceLogin,'cancel-device':actions.CancelDeviceLogin,
  'approve-device':actions.ApproveDeviceLogin,
  'deny-device':actions.DenyDeviceLogin,'set-language':actions.SetLanguage,'set-message-animations':actions.SetMessageAnimations,
  'save-shortcut':actions.SetShortcut,'reset-shortcut':actions.ResetShortcuts,
  'reset-shortcuts':actions.ResetShortcuts,
  'load-billing':actions.LoadBilling,'billing-currency':actions.ChangeBillingCurrency,'review-plan-change':actions.ReviewPlanChange,'review-scheduled-cancel':actions.ReviewScheduledCancel,'confirm-scheduled-cancel':actions.ConfirmScheduledCancel,'cancel-plan-change-review':actions.CancelPlanChangeReview,'confirm-plan-change':actions.ConfirmPlanChange,'billing-checkout':actions.BillingCheckout,
  'reactivate-account':ReactivateAccount,
  'save-semantic-preferences':actions.SaveSemanticPreferences,'billing-portal':actions.BillingPortal,'search-space':actions.SearchSpace,
  'search-next-page':actions.SearchSpace,'read-search-message':actions.ReadSearchMessage
};
function dispatchIntent(input){if(input.kind==='organizations'){engine.dispatch(organizationsAction(input));return;}if(input.kind==='navigate'&&input.view==='organizations')engine.dispatch(new OrganizationsIntent({action:'reload'}));const dataState=readModel();if(closureSession(dataState)&&!['account-data','signout','confirm-owner','cancel-owner-confirmation','set-language'].includes(input.kind))return;if(input.kind==='navigate'&&input.view==='account-data')input={kind:'account-data',action:'open'};if(input.kind==='account-data'){const detail={...input.detail,...input.form?{operationId:captureSubmission(input.form)}:{}};engine.dispatch(new AccountDataAction(input.action,detail));return;}if(input.kind==='navigate'&&input.view==='connected-apps'&&readModel().config?.integrationsEnabled)input={...input,view:'connections'};if(input.kind==='connections'){const done=engine.dispatch(connectionsAction(input));if(input.action==='reload')done.next('complete').then(()=>engine.dispatch(new AppRemovalIntent({action:'removal-load'})));return;}if(input.kind==='access'){engine.dispatch(new AccessAction(input.action,input.detail));return;}if(input.kind==='open-incoming-conversation'){const item=input.item;engine.dispatch(new actions.NavigateSpace({kind:'navigate',view:'conversations'}));engine.dispatch(new conversationActions.OpenConversation({room:item.conversation}));return;}if(input.kind==='cancel-device'||input.kind==='set-auth'&&readModel().captchaPurpose==='device')cancelDeviceEntry();if(input.kind==='signup'&&readModel().config.localDevelopment!==true&&!readSignupCaptcha(readModel().config).turnstileToken){engine.dispatch(new actions.ReportCommandError({message:'The security check is still running. Please wait a moment and try again.'}));return;}if(input.kind==='pause-setup'){cancelRecovery();pauseSetup();return;}if(input.kind==='save-resource'&&readModel().modal?.provider?.id==='google-drive'){if(input.nativeEvent?.isTrusted!==true)return;input={...input,kind:'start-google-drive'};}if(['submit-message-action','enable-automation','confirm-automation','continue-as-audience','send-authored-message'].includes(input.kind)&&input.nativeEvent?.isTrusted!==true)return;let detail={...input};delete detail.nativeEvent;if(input.kind==='accept-beam'){if(!input.files?.length){engine.dispatch(new actions.ReportCommandError({message:'Select at least one file.'}));return;}detail={...input,destination:prepareBeamDestination(input.files,input.mode)};detail.destination.catch(()=>{});}if(input.form){detail={...detail,operationId:captureSubmission(input.form)};delete detail.form;}if(detail.kind==='run-command'){dispatchCommand(detail.id);return;}const Action=constructors[detail.kind]??actions.NavigateSpace;engine.dispatch(new Action(detail));if(detail.kind==='navigate'&&detail.view==='connections')engine.dispatch(new ConnectionsIntent({action:'reload'}));if(detail.kind==='navigate'&&detail.view==='access')engine.dispatch(new AccessAction('open'));if(detail.kind==='navigate'&&detail.view==='contacts')engine.dispatch(new incomingActions.LoadDeveloperContact());if(detail.kind==='navigate'&&detail.view==='beaming')engine.dispatch(new beamActions.LoadBeaming());if(detail.kind==='navigate'&&detail.view==='conversations')engine.dispatch(new conversationActions.LoadConversations());if(detail.kind==='navigate'&&detail.view==='connected-apps')engine.dispatch(new mcpActions.LoadMCPGrants());if(detail.kind==='navigate'&&detail.view==='automation')engine.dispatch(new automationActions.LoadAutomation());}
function dispatchCommand(id){if(closureSession(readModel())||accountDataCurrent(readModel())?.interstitial)return;try{engine.dispatch(new RunPortalCommand(registry,id)).next('complete').catch(error=>engine.dispatch(new actions.ReportCommandError({message:error.message})));}catch(error){engine.dispatch(new actions.ReportCommandError({message:error.message}));}}
root.addEventListener('3sln-intent',event=>{event.stopPropagation();dispatchIntent(event.detail);});
engine.feed.addEventListener('portal-command-requested',event=>dispatchCommand(event.detail.id));
engine.feed.addEventListener('portal-intent',event=>dispatchIntent(event.detail));
engine.feed.addEventListener('shortcut-chord-expired',event=>engine.dispatch(new actions.ClearShortcutChord(event.detail)));
// Native default prevention must use the provider's current read handle, not
// wait for the next paint of the Query Cell. No second keyboard model is held.
function keydown(event){if(closureSession(readModel())||accountDataCurrent(readModel())?.interstitial||termsPending(readModel()))return;if(event.repeat)return;const model=readModel(),stroke=normalizeKeyStroke(event,navigator.platform);if(!stroke)return;const context=portalContext(model,{textInputFocus:isTextInputTarget(event.target)});const result=resolveKeybinding(compileKeybindings(defaultKeybindings(registry),model.keybindingOverrides??[],registry.list('commands')),context,model.keyChord,stroke);if(result.consumed){event.preventDefault();event.stopPropagation();}if(!result.consumed&&context.textInputFocus){if(model.keyChord?.strokes?.length)engine.dispatch(new actions.ClearShortcutChord({startedAt:model.keyChord.startedAt}));return;}engine.dispatch(new actions.PressShortcut({stroke}));}
window.addEventListener('keydown',keydown);
engine.feed.addEventListener('device-poll-due',()=>engine.dispatch(new actions.PollDeviceLogin()));
engine.feed.addEventListener('session-check-due',()=>engine.dispatch(new actions.RecheckSession()));
engine.feed.addEventListener('accounts-refresh-due',()=>engine.dispatch(new accountActions.OpenAccounts()));
engine.feed.addEventListener('network-changed',event=>engine.dispatch(new actions.NetworkChanged({online:event.detail})));
engine.feed.addEventListener('beam-invite-opened',()=>engine.dispatch(new beamActions.LoadBeaming({invite:true})));
engine.feed.addEventListener('contact-handoff',()=>engine.dispatch(new contactLinkActions.StartHandoff()));
engine.feed.addEventListener('contact-handoff-ready',()=>engine.dispatch(new contactLinkActions.ProceedHandoff()));
engine.feed.addEventListener('add-contact-opened',()=>engine.dispatch(new beamActions.LoadBeaming({addContact:true})));
engine.feed.addEventListener('beam-poll-due',()=>engine.dispatch(new beamActions.PollBeaming()));
engine.feed.addEventListener('beam-progress',event=>engine.dispatch(new beamActions.BeamProgress(event.detail)));
engine.feed.addEventListener('mcp-request-opened',()=>engine.dispatch(new mcpActions.LoadMCPRequest()));
engine.feed.addEventListener('automation-call',event=>engine.dispatch(new automationActions.InvokeAutomation(event.detail)));
engine.feed.addEventListener('google-drive-returned',()=>engine.dispatch(new googleDriveActions.CompleteGoogleDrive()));
const googleDriveCell=queryCell(engine.query(new googleDriveActions.GoogleDriveReturn()));
const automationCell=queryCell(engine.query(new automationActions.AutomationState()));
const beamCell=queryCell(engine.query(new beamActions.BeamingState()));
const stateCell=queryCell(engine.query(new actions.BrowserState())),contextCell=queryCell(engine.query(new actions.PortalContext()));
dodo.reconcile(root,[watch(stateCell,state=>watch(contextCell,context=>{return watch(googleDriveCell,()=>watch(automationCell,enabled=>watch(beamCell,()=>surfaces[state.locale??'en']({...state,messageActionReview:messageFrameResource.projection(state.modal?.id),notice:state.notice||(state.route.googleDriveCallback&&!state.session?'Sign in to finish Google Drive authorization. If this browser session changed, start a new connection from Resources.':state.notice),automation:{...state.automation,enabled},context}))));} ))]);
messageFrameResource.connect(root,readModel,dispatchIntent);
let accessHash='',consoleOwner='';const syncIntegrationRoute=()=>{const s=readModel();if(!s.config?.integrationsEnabled||!s.session?.account||s.offline)return;const route=accessRoute(location.hash),key=s.session.account.id+':'+s.session.sessionContext+':'+s.beamGeneration+':'+location.hash;if(route&&key!==accessHash){accessHash=key;engine.dispatch(new actions.NavigateSpace({kind:'navigate',view:'access'}));engine.dispatch(new AccessAction('open',{route}));}if((s.view==='connections'||new URLSearchParams(location.search).has('removal_return')||new URLSearchParams(location.search).get('view')==='connections')&&consoleOwner!==key){consoleOwner=key;if(s.view!=='connections')engine.dispatch(new actions.NavigateSpace({kind:'navigate',view:'connections'}));engine.dispatch(new ConnectionsIntent({action:'reload'})).next('complete').then(async()=>{await engine.dispatch(new AppRemovalIntent({action:'removal-load'})).next('complete');const returned=new URLSearchParams(location.search).get('removal_return');if(returned)await engine.dispatch(new AppRemovalIntent({action:'removal-return',query:returned})).next('complete');});}};addEventListener('hashchange',syncIntegrationRoute);engine.feed.addEventListener('browser-state-updated',syncIntegrationRoute);
let privateGeneration=readModel().beamGeneration??0;engine.feed.addEventListener('browser-state-updated',()=>{const generation=readModel().beamGeneration??0;if(generation!==privateGeneration){privateGeneration=generation;cancelRecovery();}messageFrameResource.sync();});
const termsFocus=new MutationObserver(()=>{const dialog=root.querySelector('[data-terms-update]');if(dialog&&!dialog.contains(document.activeElement))dialog.querySelector('h2')?.focus();});termsFocus.observe(root,{childList:true,subtree:true});
const accountDataSubscription=engine.query(new AccountDataView()).subscribe({next:()=>{}});
let accountDataOwner='';const syncAccountData=()=>{const s=readModel();if(!s.session?.account||s.offline){accountDataOwner='';return;}if(s.busy||s.stepUp||!s.data?.features&&!s.session.account.consoleFeatures&&!closureSession(s))return;const key=s.session.account.id+':'+s.session.sessionContext+':'+(s.beamGeneration??0);if(key===accountDataOwner)return;accountDataOwner=key;const query=new URLSearchParams(location.search),dataLink=query.getAll('view').length===1&&query.get('view')==='account-data';if(query.getAll('security').length===1&&query.get('security')==='review'&&!closureSession(s))engine.dispatch(new actions.NavigateSpace({kind:'navigate',view:'security'}));engine.dispatch(new AccountDataAction(dataLink?'open':'check'));};engine.feed.addEventListener('browser-state-updated',syncAccountData);engine.feed.addEventListener('account-data-check-due',()=>{const s=readModel();if(!s.busy&&!s.stepUp&&!accountDataCurrent(s)?.confirmation&&s.session?.account&&!s.offline&&(s.data?.features||s.session.account.consoleFeatures||closureSession(s)))engine.dispatch(new AccountDataAction('check'));});
engine.dispatch(new actions.InitializeSpace());
window.addEventListener('pagehide',()=>{accountDataSubscription.unsubscribe();termsFocus.disconnect();cancelRecovery();window.removeEventListener('keydown',keydown);dodo.reconcile(root,[]);engine.dispose();},{once:true});
// Back/forward cache restores a torn-down page: reload instead of showing a blank console.
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
