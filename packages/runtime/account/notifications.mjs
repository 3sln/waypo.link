import {existingFeature,siteEnabled} from './flags.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {key} from '../../core/records.mjs';
// AccountController slice 10, Notifications, push, app connections and MCP account tools (docs/architecture/app-engine.md §12): notification preferences, push devices, app connections and MCP account operations.
// `methods` are installed on AccountController.prototype (`this` is the controller); `rpc` lists the methods
// `invoke` accepts and the placement policy it applies to each (packages/runtime/account/index.mjs).
import {appNotificationCheck} from '../app-notifications.mjs';
import {mcpCollections as accountMcpCollections,mcpOperation as accountMcpOperation} from '../../mcp/account.mjs';
import {ACTIVITY_PUSH_OWNER_OPERATIONS} from '../../messaging/notifications.mjs';
import {operate} from '../../app/engine.mjs';
import {accountChannelState,accountSecurityNotice} from '../account-channels.mjs';
import {createPushTransport} from '../../messaging/web-push.mjs';
// DX-6: the push transport this account reaches its own devices with (the lifecycle's when configured).
const pushOf=c=>c.config.LIFECYCLE_PUSH??(c.securityPush??=createPushTransport(c.config));

export const methods={
 /** DX-6 (account-deletion-export.md §3): which other notice channels remain, for email removal. */
 async accountChannels(owner){if(await this.metadata.get('owner')!==owner)throw new StorageError('forbidden','Account owner mismatch.',403);return accountChannelState(this.metadata,owner,{push:pushOf(this)});},
 /** DX-6: a data-free security notice to this account's push devices (the service worker renders it). */
 async accountSecurityNotice(owner,{event}={}){if(await this.metadata.get('owner')!==owner)throw new StorageError('forbidden','Account owner mismatch.',403);return accountSecurityNotice(this.metadata,owner,{push:pushOf(this),event});},
  async approvalNoticeContacts(owner){if(!siteEnabled(this.config,'DEVICE_AUTHORIZATION_ENABLED',{subject:{kind:'account',owner}},true))return {subscriptions:[]};return {subscriptions:[...(await this.metadata.list({prefix:key('push-subscription',owner)})).values()].filter(r=>r?.owner===owner&&typeof r.endpoint==='string').slice(0,10)};},
  async appConnections(owner){return this.apps.list(owner);},
  async appConnectionBinding(owner,clientId){return this.apps.binding(owner,clientId);},
  async appConnect(owner,client,expected){return this.apps.register(owner,client,expected);},
  async appBindleConnect(owner,client,expected,permissions={}){return this.apps.register(owner,client,expected,{transport:'bindle',...permissions.integration?{integration:permissions.integration}:{},notifications:permissions.notifications===true,expectedNotificationGeneration:permissions.expectedNotificationGeneration,provenance:{kind:'oauth-consent',issuer:this.config.APP_ORIGIN}});},
  async appDisconnect(owner,id){return this.apps.disconnect(owner,id);},
  async appNotificationSettings(owner,id,input){await this.warm(owner);return this.apps.notificationSettings(owner,id,input);},
  async appNotificationCheck(owner,connection,clientId){await this.warm(owner);return appNotificationCheck(this,owner,connection,clientId);},
  async appConnectionCheck(owner,id,generation,clientId){return this.apps.check(owner,id,generation,clientId);},
  async mcpCollections(owner){return accountMcpCollections(this,owner);},
  async mcpOperation(owner,clientId,tool,args,connection){await this.apps.check(owner,connection?.id,connection?.generation,clientId);return tool==='collections_list'?this.mcpCollections(owner):accountMcpOperation(this,owner,clientId,tool,args);},
  async notificationPreferences(owner,input,verifiedEmail){return input===undefined?this.notifications.preferences(owner):this.notifications.setPreferences(owner,input,{verifiedEmail});},
  async subscribe(owner,input){return this.notifications.subscribe(owner,input.subscription||input,input.label);},
  async removeSubscription(owner,id){return this.notifications.unsubscribeDevice(owner,id);},
  async unsubscribe(owner,token){return this.notifications.unsubscribe(token);},
  async unsubscribeLink(owner){return `${owner}.${await this.notifications.issueUnsubscribe(owner,'email')}`;},
  // ACT-2 owner activity push settings; the only entry point to those engine operations, absent with the flag off.
  async activityPush(owner,name,{id,input}={}){
   if(!existingFeature(this.config,'ACTIVITY_V2_ENABLED',owner,true)||!['settings','explain'].includes(name)&&input?.enabled!==false&&!siteEnabled(this.config,'ACTIVITY_V2_ENABLED',{subject:{kind:'account',owner}},true)||typeof name!=='string'||!Object.hasOwn(ACTIVITY_PUSH_OWNER_OPERATIONS,name))throw Object.assign(new Error('Not found.'),{code:'not_found',status:404});
   const Operation=ACTIVITY_PUSH_OWNER_OPERATIONS[name];return operate(this.engine,new Operation({actor:{kind:'owner',owner},id,input:structuredClone(input)}));
  },
};

export const rpc={
 accountChannels:{lifecycle:'suspended'},
 accountSecurityNotice:{lifecycle:'suspended'},
 approvalNoticeContacts:{warm:true},
 notificationPreferences:{},
 subscribe:{},
 removeSubscription:{},
 unsubscribe:{lifecycle:'suspended'},
 unsubscribeLink:{},
 appConnections:{warm:true},
 appConnectionBinding:{warm:true},
 appConnect:{warm:true},
 appBindleConnect:{warm:true},
 appDisconnect:{warm:true},
 appNotificationSettings:{warm:true},
 appNotificationCheck:{warm:true},
 appConnectionCheck:{warm:true},
 mcpCollections:{},
 mcpOperation:{warm:true,activity:'resource-use'},
 activityPush:{warm:true},
};
