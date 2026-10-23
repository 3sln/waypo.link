// The engine supplies an already verified additive relation and the target's pinned reference.
import {validateIntentKind,validateIntentData} from './schema.mjs';
import {IntentFault} from './format.mjs';
export function projectIntent(intent,sourceBody,targetBody,{additive=false,reference}={}){
 const source=validateIntentKind(sourceBody),target=validateIntentKind(targetBody);validateIntentData(source,intent.data);
 if(!additive||source.id!==target.id||!reference||reference.artefact!==target.id)throw new IntentFault('intent_kind_invalid');
 const data=Object.fromEntries(Object.entries(intent.data).filter(([k])=>Object.hasOwn(target.data.properties,k)));validateIntentData(target,data);
 const {minter,iat,...unsigned}=intent;return {...unsigned,kind:reference,data};
}
