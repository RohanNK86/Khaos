/** Live run view served at GET / (stands in for the dashboard during the demo). */
export const LIVE_PAGE = String.raw`<!doctype html><html><head><meta charset="utf-8"><title>MCPify · live runs</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--cream:#F8F2E4;--ink:#1A1A1A;--orange:#FD9B36;--accent:#E8590C}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:"Space Grotesk",system-ui,sans-serif}
header{display:flex;align-items:center;gap:14px;padding:16px 28px;border-bottom:3px solid var(--ink)}
h1{font-family:"Archivo Black",system-ui;font-size:28px;margin:0}h1 span{color:var(--accent)}
.tag{border:2px solid var(--ink);padding:2px 10px;font-weight:700;background:#fff;box-shadow:3px 3px 0 var(--ink)}
main{display:grid;grid-template-columns:300px 1fr;gap:22px;padding:22px 28px}
.card{background:#fff;border:3px solid var(--ink);box-shadow:6px 6px 0 var(--ink);padding:14px 16px}
.runs .r{padding:10px;border:2px solid var(--ink);margin-bottom:10px;cursor:pointer;background:var(--cream)}
.runs .r.sel{background:var(--orange)}.r b{display:block;font-size:14px}.r small{font-size:12px}
.st{display:inline-block;padding:1px 8px;border:2px solid var(--ink);font-weight:700;font-size:12px;text-transform:uppercase}
.succeeded{background:#9be59b}.failed{background:#ff8a80}.running{background:#fff3a0}.awaiting_confirmation,.awaiting_user_input{background:var(--orange)}
.dry_run_complete{background:#a7d3ff}.stopped{background:#ddd}
.step{display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:start;padding:9px 0;border-bottom:1px dashed #bbb}
.dot{width:26px;height:26px;border:2px solid var(--ink);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.passed .dot{background:#9be59b}.failed .dot{background:#ff8a80}.awaiting .dot{background:var(--orange)}.blocked_dry_run .dot{background:#a7d3ff}.skipped .dot{background:#ddd}
.risk{font-size:11px;font-weight:700;padding:1px 6px;border:2px solid var(--ink)}.read{background:#eee}.fill{background:#cfe3ff}.commit{background:var(--orange)}.auth{background:#ff8a80}
.chk{font-size:12px;color:#333}.chk i{font-style:normal;font-weight:700}.ok{color:#11772b}.bad{color:#c62828}
.need{background:var(--orange);border:3px solid var(--ink);padding:12px;margin:12px 0;box-shadow:4px 4px 0 var(--ink)}
.need table{border-collapse:collapse}.need td{padding:2px 10px 2px 0}
.kpis{display:flex;gap:14px;margin:10px 0 14px}.kpi{border:2px solid var(--ink);padding:6px 12px;background:var(--cream)}.kpi b{font-family:"Archivo Black";font-size:20px;display:block}
.out{background:#9be59b;border:3px solid var(--ink);padding:12px;margin-top:12px;font-size:18px}
code{background:#eee;padding:0 4px}
</style></head><body>
<header><h1>MCP<span>ify</span></h1><span class="tag">live runs</span><span style="margin-left:auto" id="clock"></span></header>
<main><section class="card runs"><h3 style="margin-top:0">Runs</h3><div id="runs">No runs yet. Ask your agent to use a tool.</div></section>
<section class="card" id="detail"><h3 style="margin-top:0">Pick a run</h3></section></main>
<script>
let sel=null, tools={};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const loc=l=>!l?"":l.kind==="role"?"role "+l.role+' "'+l.name+'"':l.kind==="near"?'near "'+l.anchorText+'"':l.kind+' "'+l.value+'"';
async function tick(){
  const runs=await fetch("/api/runs").then(r=>r.json());
  if(!sel&&runs[0])sel=runs[0].id;
  document.getElementById("runs").innerHTML=runs.length?runs.map(r=>'<div class="r '+(r.id===sel?"sel":"")+'" onclick="sel=\''+r.id+'\';tick()"><b>'+esc(r.toolName)+'</b><span class="st '+r.status+'">'+r.status.replace(/_/g," ")+'</span>'+(r.dryRun?' <span class="st">dry run</span>':'')+'<br><small>'+new Date(r.startedAt).toLocaleTimeString()+'</small></div>').join(""):"No runs yet. Ask your agent to use a tool.";
  const r=runs.find(x=>x.id===sel); if(!r)return;
  const byId=Object.fromEntries(r.trace.map(t=>[t.stepId,t]));
  const passed=r.trace.filter(t=>t.status==="passed").length, checks=r.trace.reduce((n,t)=>n+t.preResults.length+t.postResults.length,0);
  const dur=((r.endedAt?new Date(r.endedAt):new Date())-new Date(r.startedAt))/1000;
  let h='<h3 style="margin-top:0">'+esc(r.toolTitle)+' <span class="st '+r.status+'">'+r.status.replace(/_/g," ")+'</span></h3>';
  h+='<div class="kpis"><div class="kpi"><b>'+passed+'/'+r.steps.length+'</b>steps verified</div><div class="kpi"><b>'+checks+'</b>deterministic checks</div><div class="kpi"><b>0</b>model calls in the engine</div><div class="kpi"><b>'+dur.toFixed(1)+'s</b>elapsed</div></div>';
  if(r.need){h+='<div class="need"><b>'+(r.need.kind==="confirmation"?"Waiting for the user to confirm":"Waiting for the user: "+esc(r.need.prompt))+'</b>';
    if(r.need.preview)h+='<table>'+r.need.preview.map(p=>'<tr><td>'+esc(p.label)+'</td><td><b>'+esc(p.value)+'</b></td></tr>').join("")+'</table>';h+='</div>';}
  for(const s of r.steps){const t=byId[s.id];const st=t?t.status:"todo";
    const icon={passed:"✓",failed:"✗",awaiting:"…",blocked_dry_run:"⛔",skipped:"–"}[st]||"";
    const chk=t?[...t.preResults.map(c=>["pre",c]),...t.postResults.map(c=>["post",c])].map(([k,c])=>'<span class="'+(c.ok?"ok":"bad")+'">'+k+(c.ok?" ✓":" ✗")+(c.detail&&!c.ok?" "+esc(c.detail):c.detail&&k==="post"&&c.detail.includes("=")?" "+esc(c.detail):"")+'</span>').join(" · "):"";
    h+='<div class="step '+st+'"><div class="dot">'+icon+'</div><div><b>'+esc(s.intent)+'</b><div class="chk">'+(t&&t.usedLocator?'found by <i>'+esc(loc(t.usedLocator))+'</i> · ':'')+chk+(t&&t.error?'<div class="bad">'+esc(t.error)+'</div>':'')+(st==="blocked_dry_run"?'<div><b>DRY RUN: blocked, nothing sent</b></div>':'')+'</div></div><span class="risk '+s.risk+'">'+s.risk+'</span></div>';}
  if(r.status==="succeeded")h+='<div class="out">'+Object.entries(r.outputs).map(([k,v])=>esc(k)+': <b>'+esc(v)+'</b>').join("<br>")+(r.receiptId?'<br><small>Signed receipt <code>'+esc(r.receiptId)+'</code> (Ed25519)</small>':'')+'</div>';
  document.getElementById("detail").innerHTML=h;
}
setInterval(tick,700);tick();setInterval(()=>clock.textContent=new Date().toLocaleTimeString(),1000);
</script></body></html>`;
