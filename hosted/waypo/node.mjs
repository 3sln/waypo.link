import {pathToFileURL} from 'node:url';
import {createNodeApplication,startNode} from '@3sln/waypo/node';
import {compose3slnProviderConfiguration,createHostedExtensionFactory,createHostedSignupGuard} from './composition.mjs';
export function create3slnNodeApplication(provider,billing,{resolveSignupCountry}={}){return createNodeApplication(compose3slnProviderConfiguration(provider,billing),{regionEligibility:createHostedSignupGuard(billing),resolveSignupCountry,createProviderExtension:createHostedExtensionFactory(billing)});}
export function start3slnNode(provider,billing,{resolveSignupCountry}={}){return startNode(compose3slnProviderConfiguration(provider,billing),{regionEligibility:createHostedSignupGuard(billing),resolveSignupCountry,createProviderExtension:createHostedExtensionFactory(billing)});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const {readFile}=await import('node:fs/promises'),filename=process.argv[2]??process.env.WAYPO_HOSTED_CONFIG;if(!filename)throw Error('Pass a private hosted configuration file');const input=JSON.parse(await readFile(filename,'utf8'));await start3slnNode(input.provider,input.billing);}
