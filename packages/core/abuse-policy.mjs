// Portable policy: the runtime supplies trusted network identity and an atomic
// window resource. No platform header, database or Cloudflare binding lives here.
const positive=(value,fallback)=>{value=value===undefined?fallback:value;if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+$/.test(value)))throw new TypeError('Invalid signup limit');const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new TypeError('Invalid signup limit');return n;};
export function signupCapacityLimits(config={}){const limit=positive(config.SIGNUP_MAX_ADMISSIONS,100000),freeLimit=positive(config.SIGNUP_FREE_MAX_ADMISSIONS,Math.min(10000,limit));if(freeLimit>limit)throw new TypeError('Invalid signup limit');return {limit,freeLimit};}
export function abuseWindows({operation,ipHash,subnetHash,handleHash,regionHash,signupLimits={},phase,signupKind='free'}){
 if(operation==='signup'&&phase==='attempt')return [{key:`signup:attempt:${ipHash}`,windowMs:60000,limit:5},{key:`signup:attempt-network:${subnetHash}`,windowMs:3600000,limit:100}];
 // Unauthenticated boot setup preparation: per-IP pseudonym windows plus a global ceiling.
 if(operation==='boot-begin')return [{key:`boot-begin:burst:${ipHash}`,windowMs:60000,limit:5},{key:`boot-begin:ip:${ipHash}`,windowMs:3600000,limit:20},{key:'boot-begin:global',windowMs:3600000,limit:200}];
 // Wargame 2026-10-23 #6, #10 (provisional): boot sign-in has one principal, so its windows also bound the principal
 // and the whole host, independent of the source address. Boot is passkey only (2026-10-29, provisional), so no boot
 // password window remains.
 // Boot passkey begin (review 2026-10-23, provisional): per-address windows do the work; the principal window is a high
 // backstop (600 per 5 minutes) so a distributed flood cannot hold off the operator's begin.
 if(operation==='boot-login-begin')return [{key:`boot-login-begin:burst:${ipHash}`,windowMs:60000,limit:10},{key:`boot-login-begin:ip:${ipHash}`,windowMs:3600000,limit:50},{key:'boot-login-begin:principal',windowMs:300000,limit:600}];
 // ORG-12b break-glass abort links (no sign-in): a tighter per-address budget plus a per-network one, so token guessing
 // from one network stays slow (the token is 256-bit; the organization also counts failures per claim).
 // Review L1: `peek` checks without spending; the route charges (`charge`) only refused or failed outcomes, so an owner's
 // successful stop never uses up the budget of the network they share.
 if(operation==='org-claim-abort'){const p=phase==='peek'?{peek:true}:{};return [{key:`org-claim-abort:burst:${ipHash}`,windowMs:60000,limit:5,...p},{key:`org-claim-abort:ip:${ipHash}`,windowMs:3600000,limit:20,...p},{key:`org-claim-abort:network:${subnetHash}`,windowMs:3600000,limit:200,...p}];}
 if(operation==='device-poll')return [{key:`device-poll:burst:${ipHash}`,windowMs:60000,limit:30},{key:`device-poll:ip:${ipHash}`,windowMs:600000,limit:120}];
 // Handle-keyed sign-in windows (wargame 2026-10-23 #3). They run only after the Turnstile check: `credential` peeks
 // (never counts) before the password KDF, `failure` counts one completed, failed credential check. CAPTCHA-less
 // traffic and passkey begin/finish never reach them, so nobody can lock a handle out without solving challenges and
 // guessing wrong.
 if(operation==='login'&&(phase==='credential'||phase==='failure'))return handleHash?[{key:`login:handle:${handleHash}`,windowMs:300000,limit:20,...phase==='credential'?{peek:true}:{}}]:[];
 // Email sign-in start (wargame #7; review 2026-10-23 item 5): a pseudonymized mailbox window (5 per 15 minutes, 12 per
 // 6 hours: a flood blocks one mailbox for hours, never a day) and capacity ceilings sharded by region (5,000 per hour)
 // under a high global one (20,000 per hour), charged after Turnstile whether or not the address has an account.
 if(operation==='email-login'&&phase==='mailbox')return [{key:`email-login:mailbox:${handleHash}`,windowMs:900000,limit:5},{key:`email-login:mailbox-6h:${handleHash}`,windowMs:21600000,limit:12},{key:`email-login:region:${regionHash||'unknown'}`,windowMs:3600000,limit:5000},{key:'email-login:global',windowMs:3600000,limit:20000}];
 const windows=[{key:`${operation}:burst:${ipHash}`,windowMs:60000,limit:operation==='signup'?3:10}];
 if(operation==='signup'){
  const setting=(name,fallback)=>positive(signupLimits[name],fallback),capacity=signupCapacityLimits(signupLimits);if(!['free','paid'].includes(signupKind))throw new TypeError('Invalid signup kind');
  return [{key:`signup:ip-cooldown:${ipHash}`,windowMs:setting('SIGNUP_IP_WINDOW_MS',10800000),limit:1},
   {key:`signup:ip:${ipHash}`,windowMs:86400000,limit:setting('SIGNUP_IP_DAILY_LIMIT',2)},
   {key:`signup:subnet:${subnetHash}`,windowMs:86400000,limit:setting('SIGNUP_SUBNET_DAILY_LIMIT',15)},
   {key:`signup:region-hour:${regionHash||'unknown'}`,windowMs:3600000,limit:setting('SIGNUP_REGION_HOURLY_LIMIT',5)},
   {key:`signup:region-day:${regionHash||'unknown'}`,windowMs:86400000,limit:setting('SIGNUP_REGION_DAILY_LIMIT',25)},
   {key:'signup:global-hour',windowMs:3600000,limit:setting('SIGNUP_GLOBAL_HOURLY_LIMIT',10)},
   {key:'signup:global',windowMs:86400000,limit:setting('SIGNUP_GLOBAL_DAILY_LIMIT',200)},
   // Preserve this durable key: this ceiling counts all admitted attempts,
   // including paid, deleted, pending and failed creations. It is not a live
   // free-account census and must never reset on plan changes or daily alarms.
   ...signupKind==='paid'?[{key:'signup:paid-hour',windowMs:3600000,limit:setting('SIGNUP_PAID_HOURLY_LIMIT',5)},{key:'signup:paid-day',windowMs:86400000,limit:setting('SIGNUP_PAID_DAILY_LIMIT',25)}]:[],
   {key:'signup:lifetime-admission',lifetime:true,limit:capacity.limit,signup:{kind:signupKind,freeLimit:capacity.freeLimit}}];
 }
 if(handleHash)windows.push({key:`${operation}:handle:${handleHash}`,windowMs:300000,limit:20});
 windows.push({key:`${operation}:ip:${ipHash}`,windowMs:3600000,limit:50});return windows;
}
export async function enforceAbusePolicy(resource,inputs){for(const window of abuseWindows(inputs))if(!await resource.consume(window))return false;return true;}
