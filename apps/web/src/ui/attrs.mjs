// dodo's `.attrs()` writes every key it is given, so a `null` or `undefined` value renders as the literal text
// "null"/"undefined"; an attribute is removed only when its key is absent. Wrap conditional attributes in
// present({...}) so absent values drop their keys (bug hunt F2).
export function present(attrs){const out={};for(const key in attrs)if(Object.hasOwn(attrs,key)&&attrs[key]!==null&&attrs[key]!==undefined)out[key]=attrs[key];return out;}
