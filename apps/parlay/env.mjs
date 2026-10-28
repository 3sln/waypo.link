// Retired environment names (DEVLOG 2026-10-27 "Messaging removed from core; Parlay rename"). The app's configuration
// was renamed from BINDLEBOX_* to PARLAY_*. For one rename window an unset PARLAY_<X> reads the raw BINDLEBOX_<X> value;
// the new name always wins when both are set. The app keeps no flag records, so there is no stored record an alias
// could widen. The switch itself has no alias any more (2026-10-28 review L3): BINDLEBOX_ENABLED is a retired name in
// the core flag registry (packages/flags/registry.mjs RETIRED_FLAGS), so a leftover BINDLEBOX_ENABLED=true no longer
// turns Parlay on; set PARLAY_ENABLED.
export const PARLAY_ENV_NAMES=Object.freeze(['SERVICES','EGRESS','KEY_ENCRYPTION_KEY','CLIENT_ID','ADAPTER_MODULE','DATA_DIRECTORY','LOCAL_TEST_KEY_HOLDER']);
/** A copy of `env` with each unset PARLAY_<X> filled from the retired BINDLEBOX_<X>; other members are unchanged. */
export function parlayEnv(env){
 if(!env||typeof env!=='object')return env;
 const out=Object.assign(Object.create(null),env);
 for(const name of PARLAY_ENV_NAMES)if(out['PARLAY_'+name]===undefined&&out['BINDLEBOX_'+name]!==undefined)out['PARLAY_'+name]=out['BINDLEBOX_'+name];
 return out;
}
