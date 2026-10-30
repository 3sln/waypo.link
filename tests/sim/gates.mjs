// Gate checks G1–G7 (spike §3.5) over one run's evidence. Each gate returns {id, status: pass|fail|info, summary, details}.
import {redactIntentLog} from '../../packages/intents/redaction.mjs';

/** Provider error codes that are protocol steps, not failures: a browser logs them as resource errors. */
export const EXPECTED_HTTP=Object.freeze([
 {code:'use_dpop_nonce',reason:'RFC 9449 §8: the first token request learns the DPoP nonce from a 400 use_dpop_nonce answer; the SDK retries once with it.'},
 {code:'invite_unverifiable',reason:'Expected-pending step parlay.cross-provider.invite: Parlay refuses a foreign inviter with 403 invite_unverifiable (messaging CL-24, same-host only); the page shows connectUnverifiable.'}
]);
/** Observed provider defects, each with where it lives. They are reported (gallery, manifest) instead of failing G2,
 * and a known defect that is no longer observed fails G2 until it is removed here, so entries cannot go stale. */
export const KNOWN_DEFECTS=Object.freeze([
 // Board (step board.org.member-token, expected-pending): a valid member certificate exchanged at the organization's
 // token endpoint answers `invalid_grant`, because no flow connects an app to an organization (the member token needs a
 // live org app connection and grant). The browser logs the 400 as a resource error.
 {id:'org-member-token-no-app-connection',part:'board',httpCode:'invalid_grant',where:'packages/runtime/account/member-certificates.mjs memberTokenAdmit (connection) / packages/federation/member-access.mjs (grant); no org authorization flow'}
]);
/** Applied only when the local asset build stopped before writing sw.js (recorded in the manifest's environment). */
export const INCOMPLETE_BUILD=Object.freeze({match:/console-error https:\/\/(alpha|beta)\.example A bad HTTP response code \(404\) was received when fetching the script\./,reason:'Local asset build incomplete (no .output/public/sw.js): the console service worker registration answers 404. CI builds completely.'});
/** Known page messages that are not defects, each with its reason. Matched against `${kind} ${origin} ${text}`. */
export const HEALTH_ALLOWLIST=Object.freeze([
 {match:/console-error https:\/\/(alpha|beta)\.example Failed to load resource: the server responded with a status of 401/,reason:'Provider pages probe /api/session-scoped endpoints before sign-in; a 401 answer is the signed-out state, logged by Chromium as a resource error.'},
 {match:/console-error https:\/\/(alpha|beta)\.example Failed to load resource: the server responded with a status of 404 \(Not Found\)$/,reason:'Optional provider assets (badge sprite or per-account avatar) answer 404 when absent.'}
]);

const pct=(values,p)=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(p/100*sorted.length)-1)];};

export function evaluateGates({incompleteBuild=false,results,health,world,processLog,shots,replay,previous,secrets,parts=null}){
 const gates=[];
 // G1 expectations
 const failed=results.filter(r=>!r.ok);
 gates.push({id:'G1',title:'Step expectations',status:failed.length?'fail':'pass',summary:`${results.filter(r=>r.ok).length}/${results.length} steps met their expectation; ${results.filter(r=>r.outcome==='pending-held').length} expected-pending held`,details:failed.map(r=>({id:r.id,outcome:r.outcome,error:r.error}))});
 // G2 page health
 // HTTP answers are evidence, not failures by themselves. A Chromium "Failed to load resource" console error is explained
 // when the same person's page received a matching status whose provider code is an expected protocol step.
 const http=health.filter(h=>h.info),pool=new Map();for(const h of http)if(EXPECTED_HTTP.some(e=>h.error?.startsWith(e.code+':'))||KNOWN_DEFECTS.some(d=>d.httpCode&&h.error?.startsWith(d.httpCode+':'))||!h.error&&/\/oauth\/token$/.test(h.text)){const key=`${h.actor} ${h.kind.slice(5)}`;pool.set(key,(pool.get(key)??0)+1);}
 const explained=h=>{const m=/^Failed to load resource: the server responded with a status of (\d{3})/.exec(h.text);if(h.kind!=='console-error'||!m)return false;const key=`${h.actor} ${m[1]}`,n=pool.get(key)??0;if(!n)return false;pool.set(key,n-1);return true;};
 const line=h=>`${h.kind} ${h.origin} ${h.text}`,defects=KNOWN_DEFECTS.map(d=>({...d,observed:health.filter(h=>d.match?d.match.test(line(h)):h.error?.startsWith(d.httpCode+':')).length}));
 const allow=[...HEALTH_ALLOWLIST,...incompleteBuild?[INCOMPLETE_BUILD]:[]];
 const unexplained=health.filter(h=>!h.info&&!explained(h)&&!allow.some(a=>a.match.test(line(h)))&&!KNOWN_DEFECTS.some(d=>d.match?.test(line(h))));
 // A defect tied to a scenario part (`part`) can only be observed when that part ran (CLI --parts narrows a run).
 const stale=defects.filter(d=>!d.observed&&(!d.part||!parts||parts.includes(d.part)));
 gates.push({id:'G2',title:'Page health',status:unexplained.length||stale.length?'fail':'pass',summary:`${health.filter(h=>!h.info).length} page messages (${http.length} HTTP ≥400 answers recorded), ${unexplained.length} unexplained, ${defects.filter(d=>d.observed).length} known defects observed${stale.length?`, ${stale.length} known defects no longer observed (remove them)`:''}`,knownDefects:defects.map(({match,...d})=>d),details:unexplained.slice(0,50),expectedHttp:EXPECTED_HTTP,allowlist:allow.map(a=>({match:String(a.match),reason:a.reason}))});
 // G3 server health and egress
 const fivexx=[...Object.values(world.providers).flatMap(p=>p.errors),...world.appLogs.filter(l=>l.status>=500)];
 const egress=world.network.violations;
 const leaks=[];for(const line of processLog){if(redactIntentLog(line)!==line)leaks.push({line:line.slice(0,160),reason:'redactIntentLog would change this line'});for(const s of secrets)if(s&&line.includes(s))leaks.push({line:'[redacted]',reason:'a known secret value appears in process output'});}
 gates.push({id:'G3',title:'Server health and egress',status:fivexx.length||egress.length||leaks.length?'fail':'pass',summary:`${fivexx.length} 5xx answers, ${egress.length} egress refusals outside the run's hosts, ${leaks.length} log findings`,details:{fivexx:fivexx.slice(0,50),egress:egress.slice(0,50),leaks:leaks.slice(0,20),browserNoise:world.network.events.filter(e=>e.kind==='browser-noise').length}});
 // G4 invariants (asserted inside the invariant steps; summarised here)
 const invariants=results.filter(r=>r.kind==='invariant'||/\.sync\.|verify|photos\.add|removal/.test(r.id));
 gates.push({id:'G4',title:'Post-run invariants',status:invariants.every(r=>r.ok)?'pass':'fail',summary:`${invariants.filter(r=>r.ok).length}/${invariants.length} invariant steps hold`,details:invariants.map(r=>({id:r.id,outcome:r.outcome}))});
 // G5 layout
 const layout=shots.findings.filter(f=>f.severity!=='info');
 gates.push({id:'G5',title:'Layout at 390 px and colour scheme',status:layout.length?'fail':'pass',summary:`${layout.length} layout failures, ${shots.findings.length-layout.length} informational`,details:shots.findings});
 // G6 determinism
 gates.push({id:'G6',title:'Deterministic replay',status:replay?(replay.match?'pass':'fail'):'info',summary:replay?(replay.match?`replay digest matches (${replay.digest.slice(0,12)})`:`digest ${replay.digest.slice(0,12)} ≠ replay ${replay.replayDigest.slice(0,12)}`):'not checked in this run (use --replay)',details:replay??null});
 // G7 budget (informational)
 const byKind={};for(const r of results.filter(r=>r.outcome!=='skipped'))(byKind[r.kind]??=[]).push(r.ms);
 const budget=Object.fromEntries(Object.entries(byKind).map(([kind,values])=>[kind,{count:values.length,p95:pct(values,95),previousP95:previous?.budget?.[kind]?.p95??null}]));
 gates.push({id:'G7',title:'Step budget',status:'info',summary:Object.entries(budget).map(([k,v])=>`${k} p95 ${v.p95} ms${v.previousP95?` (was ${v.previousP95})`:''}`).join('; '),details:budget});
 return {gates,budget,passed:gates.every(g=>g.status!=='fail')};
}

