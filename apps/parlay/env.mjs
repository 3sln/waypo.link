// Retired environment names (DEVLOG 2026-10-27 "Messaging removed from core; Parlay rename"). The app's switches and
// configuration were renamed from BINDLEBOX_* to PARLAY_*. For one rename window an unset PARLAY_<X> reads the raw
// BINDLEBOX_<X> value; the new name always wins when both are set (the core registry's envAlias rule). The app keeps
// no flag records, so there is no stored record an alias could widen; the core registry's own retired
// BINDLEBOX_ENABLED (replaced by LINKS_ENABLED) is unchanged and still quarantines a stored record under that name.
export const PARLAY_ENV_NAMES=Object.freeze(['ENABLED','SERVICES','EGRESS','KEY_ENCRYPTION_KEY','CLIENT_ID','ADAPTER_MODULE','DATA_DIRECTORY','LOCAL_TEST_KEY_HOLDER']);
/** A copy of `env` with each unset PARLAY_<X> filled from the retired BINDLEBOX_<X>; other members are unchanged. */
export function parlayEnv(env){
 if(!env||typeof env!=='object')return env;
 const out=Object.assign(Object.create(null),env);
 for(const name of PARLAY_ENV_NAMES)if(out['PARLAY_'+name]===undefined&&out['BINDLEBOX_'+name]!==undefined)out['PARLAY_'+name]=out['BINDLEBOX_'+name];
 return out;
}
