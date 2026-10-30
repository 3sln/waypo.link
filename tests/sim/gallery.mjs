// The static screenshot gallery: one self-contained index.html beside manifest.json (no external requests).
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function galleryHtml(manifest){
 const shots=manifest.shots??[],groups=new Map();
 for(const shot of shots){const key=`${shot.scenario}\u0000${shot.step}\u0000${shot.moment}`;if(!groups.has(key))groups.set(key,{scenario:shot.scenario,step:shot.step,moment:shot.moment,title:shot.title,element:shot.element,actor:shot.actor,surface:shot.surface,items:[]});groups.get(key).items.push(shot);}
 const gateRows=(manifest.gates??[]).map(g=>`<tr class="g-${esc(g.status)}"><th>${esc(g.id)}</th><td>${esc(g.title)}</td><td><span class="badge ${esc(g.status)}">${esc(g.status)}</span></td><td>${esc(g.summary)}</td></tr>`).join('');
 const pending=(manifest.steps??[]).filter(s=>typeof s.expect==='object'),failures=(manifest.steps??[]).filter(s=>!s.ok);
 const pendingRows=pending.map(s=>`<li><code>${esc(s.id)}</code> — <strong>${esc(s.outcome)}</strong>: ${esc(s.expect.pending)} <em>(${esc(s.expect.rule)})</em></li>`).join('');
 const defects=(manifest.gates??[]).find(g=>g.id==='G2')?.knownDefects??[],defectRows=defects.map(d=>`<li><code>${esc(d.id)}</code> — observed ${esc(d.observed)}×: ${esc(d.where)}</li>`).join('');
 const elements=[...new Map(shots.filter(x=>x.element).map(x=>[x.moment,x])).values()],elementRows=elements.map(x=>`<li><strong>${esc(x.element)}</strong> — ${esc(x.title)} (<code>${esc(x.moment)}</code>)</li>`).join('');
 const failureRows=failures.map(s=>`<li><code>${esc(s.id)}</code> — ${esc(s.outcome)}${s.error?`: ${esc(s.error)}`:''}</li>`).join('');
 const sections=[...groups.values()].map(g=>`<section class="moment" data-scenario="${esc(g.scenario)}"><header><h3>${esc(g.title)}</h3><p><code>${esc(g.moment)}</code> · step <code>${esc(g.step)}</code> · ${esc(g.surface)}${g.element?` · element: ${esc(g.element)}`:''}</p></header><div class="grid">${g.items.map(s=>`<figure data-locale="${esc(s.locale)}" data-scheme="${esc(s.scheme)}" data-width="${s.viewport.width}" class="w${s.viewport.width}"><a href="${esc(s.path)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(s.path)}" alt="${esc(g.title)} (${esc(s.locale)}, ${esc(s.scheme)}, ${s.viewport.width} px)"></a><figcaption>${esc(s.locale)} · ${esc(s.scheme)} · ${s.viewport.width} px</figcaption></figure>`).join('')}</div></section>`).join('');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Simulation ${esc(manifest.runId)}</title>
<style>
:root{--bg:#f6f5f2;--fg:#1d1c1a;--muted:#67625b;--card:#fff;--line:#e2ded7;--pass:#2f6b46;--fail:#a3322b;--info:#3a5a8c;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#161514;--fg:#efebe6;--muted:#a59f97;--card:#211f1d;--line:#34312d;--pass:#8fcf9e;--fail:#f08a80;--info:#9db8e8;color-scheme:dark}}
:root[data-theme=dark]{--bg:#161514;--fg:#efebe6;--muted:#a59f97;--card:#211f1d;--line:#34312d;--pass:#8fcf9e;--fail:#f08a80;--info:#9db8e8;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1440px;margin:auto;padding:24px 16px 64px}h1{margin:0 0 4px;font-size:24px}h2{margin:32px 0 12px;font-size:18px}h3{margin:0;font-size:16px}
.muted{color:var(--muted)}.caveat{padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}th,td{text-align:left;padding:8px 10px;border-top:1px solid var(--line);vertical-align:top}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-weight:600;font-size:12px}.badge.pass{color:var(--pass);border:1px solid var(--pass)}.badge.fail{color:var(--fail);border:1px solid var(--fail)}.badge.info{color:var(--info);border:1px solid var(--info)}
.filters{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:16px;padding:10px 0;background:var(--bg);border-bottom:1px solid var(--line)}.filters label{display:inline-flex;gap:6px;align-items:center}
.moment{margin:20px 0;padding:14px;background:var(--card);border:1px solid var(--line);border-radius:12px}.moment header p{margin:2px 0 10px;color:var(--muted)}
.grid{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}figure{margin:0}figure.w390 img{width:180px}figure.w1280 img{width:420px}img{display:block;border:1px solid var(--line);border-radius:8px;background:#fff}figcaption{color:var(--muted);font-size:12px;margin-top:4px}
figure[hidden],.moment[hidden]{display:none}code{font-size:12.5px}
</style></head><body><main>
<h1>Multi-provider simulation</h1>
<p class="muted">Run <code>${esc(manifest.runId)}</code> · scenario <code>${esc(manifest.scenario)}</code> · seed ${esc(manifest.seed)} · profile <code>${esc(manifest.profile)}</code> · ${esc(manifest.startedAt)} · ${esc(Math.round((manifest.durationMs??0)/1000))} s · ${shots.length} screenshots</p>
<p class="caveat">Every provider in this run is written by the same authors, so a pass is evidence of self-consistency, not interoperability. Flags that production keeps off are on in this profile; a simulation pass is never cited as meeting their production gates.</p>
<h2>Gates</h2><table><tbody>${gateRows}</tbody></table>
<h2>Expected-pending steps</h2>${pendingRows?`<ul>${pendingRows}</ul>`:'<p class="muted">None.</p>'}
<h2>Known provider defects (observed, reported, not failing the run)</h2>${defectRows?`<ul>${defectRows}</ul>`:'<p class="muted">None observed.</p>'}
<h2>Bindle element states captured</h2>${elementRows?`<ul>${elementRows}</ul>`:'<p class="muted">No screenshots in this run.</p>'}
${manifest.environment?.incompleteAssetBuild?'<p class="caveat">The local asset build was incomplete (no sw.js); service-worker 404s were allowed for this run only.</p>':''}
<h2>Failures</h2>${failureRows?`<ul>${failureRows}</ul>`:'<p class="muted">None.</p>'}
<h2>Screenshots</h2>
<div class="filters" role="group" aria-label="Filters">
<label>Locale <select data-filter="locale"><option value="">all</option><option>en</option><option>es</option></select></label>
<label>Scheme <select data-filter="scheme"><option value="">all</option><option>light</option><option>dark</option></select></label>
<label>Width <select data-filter="width"><option value="">all</option><option>390</option><option>1280</option></select></label>
<label>Page theme <select id="theme"><option value="">system</option><option>light</option><option>dark</option></select></label>
</div>
${sections||'<p class="muted">No screenshots in this run (use --screenshots).</p>'}
</main><script>
const filters=[...document.querySelectorAll('[data-filter]')];
function apply(){const want=Object.fromEntries(filters.map(f=>[f.dataset.filter,f.value]));for(const fig of document.querySelectorAll('figure')){fig.hidden=Object.entries(want).some(([k,v])=>v&&fig.dataset[k]!==v);}for(const m of document.querySelectorAll('.moment'))m.hidden=![...m.querySelectorAll('figure')].some(f=>!f.hidden);}
filters.forEach(f=>f.addEventListener('change',apply));
document.getElementById('theme').addEventListener('change',e=>{if(e.target.value)document.documentElement.dataset.theme=e.target.value;else delete document.documentElement.dataset.theme;});
</script></body></html>`;
}
