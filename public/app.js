const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
// API_BASE: same-origin by default (Cloudflare Workers serves frontend + API).
// GitHub Pages build injects <meta name="api-base" content="https://...workers.dev">.
const API_BASE=(document.querySelector('meta[name="api-base"]')||{}).content||"";
let api=async(path,opt={})=>{const r=await fetch(API_BASE+path,{headers:{"content-type":"application/json"},...opt});const d=await r.json();if(!r.ok)throw Error(d.error||"Request failed");return d};

// Global loading indicator: thin progress bar + busy state on the clicked button.
let pending=0;
const loadbar=document.createElement("div");loadbar.id="loadbar";document.body.prepend(loadbar);
const rawApi=api;
api=async(...a)=>{
  pending++;document.body.classList.add("loading");loadbar.style.width="70%";
  try{return await rawApi(...a);}
  catch(e){loadbar.style.background="#f87171";throw e;}
  finally{pending--;if(pending<=0){pending=0;loadbar.style.width="100%";document.body.classList.remove("loading");setTimeout(()=>{loadbar.style.width="0";loadbar.style.background="";},350);}}
};
document.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b||b.disabled)return;
  b.classList.add("busy");b.setAttribute("aria-busy","true");
  const stop=()=>{b.classList.remove("busy");b.removeAttribute("aria-busy");};
  if(!pending){setTimeout(stop,250);return;}
  const check=setInterval(()=>{if(!pending){clearInterval(check);stop();}},120);
  setTimeout(()=>{clearInterval(check);stop();},45000);
});

$$(".tabs button").forEach(b=>b.onclick=()=>{$$(".tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");$$(".tab").forEach(x=>x.classList.add("hidden"));$("#"+b.dataset.tab).classList.remove("hidden")});

async function loadDashboard(){
  const d=await api("/api/dashboard");
  if(d.profile){
    $("#hudLevel").textContent="Lv."+(d.profile.level||1);
    $("#hudXp").textContent=(d.profile.xp||0)+" XP";
    $("#hudCoins").textContent=(d.profile.coins||0)+" 🪙";
    $("#hudStreak").textContent=d.profile.streak_days?("🔥 "+d.profile.streak_days+" day streak"):"";
    if(d.profile.current_reading){$("#curR").value=d.profile.current_reading;$("#curL").value=d.profile.current_listening;$("#curW").value=d.profile.current_writing;$("#curS").value=d.profile.current_speaking;}
  }
  const pr=d.priorities;
  if(pr){
    $("#priority").innerHTML=
      `<p><b>Current:</b> R ${pr.currents.reading} · L ${pr.currents.listening} · W ${pr.currents.writing} · S ${pr.currents.speaking} → <b>Min Overall 8.0</b> / Stretch 8.5</p>`+
      ((pr.todayPriority||[]).map(p=>`<div class="pri"><b>${p.skill}</b> · ${p.pattern} <span class="tag">${p.priority}</span><span class="muted">evidence ${p.evidence_count}</span></div>`).join("")||`<p class="muted">No weakness data yet - log attempts below or run Day 1 Diagnostic.</p>`)+
      `<p class="muted">⏱ ${pr.timeSplit.highImpactMin} min high-impact / ${pr.timeSplit.maintenanceMin} min maintenance</p>`;
  }
  $("#days").innerHTML=(d.days.length?d.days:Array.from({length:20},(_,i)=>({day:i+1,target:"Click Create 20-day Ascension plan"}))).map(x=>`
    <div class="day ${x.completed?"done":""}">
      <div class="day-top"><b>Day ${x.day}</b><input type="checkbox" ${x.completed?"checked":""} data-day="${x.day}"></div>
      <p>${x.target||""}</p>
    </div>`).join("");
  $$("#days input").forEach(c=>c.onchange=async()=>{await api("/api/plan/toggle",{method:"POST",body:JSON.stringify({day:c.dataset.day,completed:c.checked})});loadDashboard()});
  renderNodes(d.quests);
  renderNextBest();
}
$("#seedPlan").onclick=async()=>{await api("/api/plan/seed",{method:"POST"});loadDashboard()};
const seedTop=$("#seedPlanTop");if(seedTop)seedTop.onclick=async()=>{await api("/api/plan/seed",{method:"POST"});loadDashboard()};
loadDashboard();

$("#saveProfile").onclick=async()=>{
  await api("/api/profile",{method:"POST",body:JSON.stringify({reading:+$("#curR").value,listening:+$("#curL").value,writing:+$("#curW").value,speaking:+$("#curS").value})});
  loadDashboard();
};

$$("[data-log]").forEach(b=>b.onclick=async()=>{
  const skill=b.dataset.log;
  const pattern=prompt(skill+" - question type / error pattern? (vd: TFNG, distractors, thesis, fluency)","general");
  if(!pattern) return;
  const correct=confirm("Did you get it CORRECT? OK=correct, Cancel=wrong");
  await api("/api/attempts/log",{method:"POST",body:JSON.stringify({skill,questionType:pattern,correct})});
  loadDashboard();
});

$("#completeQuest").onclick=async()=>{
  $("#questResult").textContent="Scoring quest...";
  const d=await api("/api/quests/complete",{method:"POST",body:JSON.stringify({
    total:+$("#qTotal").value,correct:+$("#qCorrect").value,explained:+$("#qExplained").value,fixedOldErrors:+$("#qFixed").value,
    title:"Board quest",kingdom:"mixed"})});
  $("#questResult").textContent=`+${d.xp} XP · +${d.coins} coins · ${d.combo||"no combo"} · accuracy ${Math.round(d.accuracy*100)}%`;
  loadDashboard();
};

$("#genBoss").onclick=async()=>{
  $("#bossOut").innerHTML='<p class="muted">Reading your memory...</p>';
  const d=await api("/api/boss/generate",{method:"POST",body:JSON.stringify({day:10})});
  $("#bossOut").innerHTML=`<div class="card"><h4>${d.title}</h4><p>${d.questions} questions · ${d.minutes} min</p><p><b>Focus:</b> ${(d.focus||[]).map(f=>f.skill+"/"+f.pattern).join(", ")||"mixed"}</p></div>`;
};

$("#generateVocab").onclick=async()=>{
  const status=$("#vocabStatus");status.textContent="Generating 100 words + quiz...";
  try{
    const d=await api("/api/vocab/generate",{method:"POST",body:JSON.stringify({topic:$("#vocabTopic").value,count:+$("#vocabCount").value})});
    status.textContent=`Saved set: ${d.topic}`;
    $("#vocabOutput").innerHTML=`<div class="card"><h3>${d.topic}</h3><div class="flash-grid">${d.words.map(w=>`
      <article class="flash"><h4>${w.word}</h4><span class="tag">${w.pos}</span><span class="tag">difficulty ${w.difficulty}</span>
      <p><b>EN:</b> ${w.definition}</p><p><b>VI:</b> ${w.meaning_vi}</p><p><b>Example:</b> ${w.example}</p>
      <p><b>Collocations:</b> ${(w.collocations||[]).join(", ")}</p><p><b>Synonyms:</b> ${(w.synonyms||[]).join(", ")}</p></article>`).join("")}</div>
      <h3>Quiz</h3>${d.questions.map((q,i)=>`<div class="card"><b>${i+1}. ${q.question}</b><ol>${q.options.map(o=>`<li>${o}</li>`).join("")}</ol><details><summary>Answer</summary><p>${q.answer} - ${q.explanation}</p></details></div>`).join("")}</div>`;
  }catch(e){status.textContent=e.message}
};

$("#paraphraseBtn").onclick=async()=>{
  $("#paraOutput").innerHTML='<p class="muted">Forging paraphrases...</p>';
  const d=await api("/api/paraphrase",{method:"POST",body:JSON.stringify({text:$("#paraText").value})});
  $("#paraOutput").innerHTML=(d.versions||[]).map((v,i)=>`<div class="card"><h3>Version ${i+1}</h3><p>${v.text}</p><p class="muted">${(v.techniques||[]).join(" · ")} - ${v.notes||""}</p></div>`).join("")+
  `<div class="card"><h3>Key changes</h3>${(d.key_changes||[]).map(x=>`<p><b>${x.original}</b> → ${x.replacement}<br>${x.reason}</p>`).join("")}</div>`;
};

$("#writingBtn").onclick=async()=>{
  $("#writingOutput").innerHTML='<p class="muted">Assessing writing against 4 criteria...</p>';
  const d=await api("/api/writing/feedback",{method:"POST",body:JSON.stringify({task:$("#writingTask").value,prompt:$("#writingPrompt").value,answer:$("#writingAnswer").value})});
  $("#writingOutput").innerHTML=`<div class="card"><div class="score">${d.estimated_band||"-"}</div>
  <h3>Estimated band</h3><p class="muted">AI estimate only; not an official IELTS score.</p>
  ${Object.entries(d.criteria||{}).map(([k,v])=>`<p><b>${k}:</b> ${v}</p>`).join("")}
  <h3>Errors</h3>${(d.errors||[]).map(e=>`<p><b>${e.issue}</b><br>${e.quote}<br>→ ${e.fix}</p>`).join("")}
  <h3>Action plan</h3><ul>${(d.action_plan||[]).map(x=>`<li>${x}</li>`).join("")}</ul></div>`;
};

$("#speakingBtn").onclick=async()=>{
  $("#speakingOutput").innerHTML='<p class="muted">Analysing transcript...</p>';
  const d=await api("/api/speaking/feedback",{method:"POST",body:JSON.stringify({part:2,transcript:$("#speakingTranscript").value})});
  $("#speakingOutput").innerHTML=`<div class="card"><div class="score">${d.estimated_band||"-"}</div>
  <p>${d.fluency_coherence||""}</p><p>${d.lexical_resource||""}</p><p>${d.grammar||""}</p>
  <p class="muted">${d.pronunciation_note||""}</p><h3>Better phrases</h3><ul>${(d.better_phrases||[]).map(x=>`<li>${x}</li>`).join("")}</ul></div>`;
};
// ---------- Spec: diagnostic, board nodes, timed runner, Paraphrase Forge ----------

$("#diagBtn").onclick=async()=>{
  const m=($("#dgScore").value||"0/0").split("/");
  const d=await api("/api/diagnostic/submit",{method:"POST",body:JSON.stringify({
    bands:{reading:+$("#dgR").value,listening:+$("#dgL").value,writing:+$("#dgW").value,speaking:+$("#dgS").value},
    results:[{skill:"reading",questionType:$("#dgType").value,correct:+m[0]||0,total:+m[1]||0}]
  })});
  const top=(d.priorities.components||[])[0];
  $("#diagOut").textContent="Saved. Top priority: "+(top?top.skill+"/"+top.pattern:"n/a");
  loadDashboard();
};

$("#genQuest").onclick=async()=>{
  const d=await api("/api/quests/generate",{method:"POST",body:JSON.stringify({day:+$("#genDay").value})});
  $("#genOut").textContent=d.quest.title+" ("+d.quest.type+", "+d.questions.length+" bank questions)";
  $("#runQuestId").value=d.quest.id;
  loadDashboard();
};

function renderNodes(quests){
  const el=$("#questNodes");
  if(!el) return;
  el.innerHTML=(quests||[]).map(q=>`
    <button class="node node-${q.status}" data-qid="${q.id}" ${q.status==="locked"?"disabled":""}>
      <b>${q.title||"Quest"}</b>
      <span class="tag">${q.quest_type||""}</span>
      <span class="tag">${q.status||""}</span>
      ${q.xp_reward?`<span class="muted">+${q.xp_reward} XP</span>`:""}
    </button>`).join("")||`<p class="muted">No quests yet. Generate one from evidence.</p>`;
  el.querySelectorAll("button[data-qid]").forEach(b=>b.onclick=()=>{
    $("#runQuestId").value=b.dataset.qid;
    document.querySelector('[data-tab="quest"]').click();
  });
}

function renderNextBest(){
  api("/api/next-actions").then(a=>{
    const el=$("#nextBest");
    if(el) el.innerHTML=(a||[]).map(n=>`<div class="pri"><b>${n.rank}. ${n.action}</b><br><span class="muted">${n.reason||""}</span></div>`).join("")||`<p class="muted">No direction yet. Complete a quest first.</p>`;
  }).catch(()=>{});
}

// ---------- Timed runner (spec section 9) ----------
let run=null, timerInt=null;
const fmtT=ms=>{const s=Math.max(0,Math.round(ms/1000));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");};

$("#startQuest").onclick=async()=>{
  const qid=$("#runQuestId").value.trim();
  if(!qid) return;
  $("#runner").innerHTML='<p class="muted">Loading timed quest...</p>';
  const d=await api("/api/quest/start",{method:"POST",body:JSON.stringify({questId:qid})});
  run={...d,answers:{},warned:{},endAt:Date.now()+d.durationMin*60000,t0:new Date().toISOString()};
  try{const saved=JSON.parse(localStorage.getItem("run-"+qid)||"{}");run.answers=saved.answers||{};}catch(e){}
  renderRunner();
  clearInterval(timerInt);
  timerInt=setInterval(tickRun,1000);
};

function renderRunner(){
  const el=$("#runner");
  const total=run.questions.length;
  const done=Object.keys(run.answers).filter(k=>run.answers[k]).length;
  el.innerHTML=`<div class="panel"><h3>${run.quest.title}</h3>
    <div class="run-top"><span id="runTimer">${fmtT(run.endAt-Date.now())}</span>
    <span>Question ${Math.min(total,done+1)} / ${total}</span>
    <span id="runWarn" class="muted"></span></div>
    <div class="progress"><div id="runBar" style="width:${total?Math.round(done/total*100):0}%"></div></div>
    ${run.questions.map((q,i)=>`<div class="card"><p><b>${i+1}. ${q.prompt}</b></p>
      ${(JSON.parse(q.options_json||"[]")).map(o=>`<label class="opt"><input type="radio" name="q-${q.id}" value="${o}" ${run.answers[q.id]===o?"checked":""}> ${o}</label>`).join("")}
      ${!(JSON.parse(q.options_json||"[]")).length?`<input data-qid="${q.id}" value="${run.answers[q.id]||""}" placeholder="Your answer">`:""}
    </div>`).join("")||`<p class="muted">No bank questions yet. Add some in Sources/Questions or answer from your material, then submit.</p>`}
    <button id="submitRun">Submit quest</button></div>`;
  el.querySelectorAll("input[type=radio]").forEach(r=>r.onchange=()=>{run.answers[r.name.slice(2)]=r.value;saveRun();renderRunner();});
  el.querySelectorAll("input[data-qid]").forEach(inp=>inp.oninput=()=>{run.answers[inp.dataset.qid]=inp.value;saveRun();});
  $("#submitRun").onclick=()=>submitRun(false);
}

function saveRun(){try{localStorage.setItem("run-"+run.quest.id,JSON.stringify({answers:run.answers}));}catch(e){}}
function tickRun(){
  const left=run.endAt-Date.now();
  const el=$("#runTimer");if(el)el.textContent=fmtT(left);
  const pct=100*(1-left/(run.durationMin*60000));
  for(const w of run.warnings||[]){
    if(pct>=w&&!run.warned[w]){run.warned[w]=1;const t=$("#runWarn");if(t)t.textContent=w+"% of time used";}
  }
  const bar=$("#runBar");if(bar){const total=run.questions.length;const done=Object.keys(run.answers).filter(k=>run.answers[k]).length;bar.style.width=(total?Math.round(done/total*100):0)+"%";}
  if(left<=0)submitRun(true);
}

async function submitRun(auto){
  clearInterval(timerInt);
  const answers=Object.entries(run.answers).map(([questionId,answer])=>({questionId,answer}));
  const d=await api("/api/quest/submit",{method:"POST",body:JSON.stringify({questId:run.quest.id,answers,startedAt:run.t0,hintsUsed:0})});
  try{localStorage.removeItem("run-"+run.quest.id);}catch(e){}
  const html=`<div class="card"><h3>QUEST RESULT${auto?" (auto-submitted)":""}</h3>
    <p>Score: ${d.score}/${d.total} · Accuracy: ${Math.round(d.accuracy*100)}% · Time: ${fmtT(d.timeMs)}</p>
    <p><b>+${d.xp} XP · +${d.coins} coins</b> ${d.combo?"· "+d.combo:""}</p>
    <p><b>Strong:</b> ${(d.strong||[]).join(", ")||"-"}</p>
    <p><b>Weak:</b> ${(d.weak||[]).join(", ")||"-"}</p>
    <h3>NEXT BEST ACTION</h3>
    <ul>${(d.nextBest||[]).map(n=>`<li>${n.action} <span class="muted">(${n.reason||""})</span></li>`).join("")}</ul>
    <p class="muted">Estimated time: ${d.estimatedMinutes||0} minutes · Practice estimate, not an official score.</p></div>`;
  $("#runner").innerHTML=html;
  const qb=$("#questResultBoard");if(qb)qb.innerHTML=html;
  run=null;
  loadDashboard();
}

// ---------- Paraphrase Forge (spec sections 13-20) ----------
let forge={item:null,slots:[],idx:0,fails:0,mistakes:0,firstTry:0,t0:0,strict:true};

$("#forgeMode").onclick=()=>{
  forge.strict=!forge.strict;
  $("#forgeMode").textContent="Mode: "+(forge.strict?"strict":"flexible");
  $("#forgeFlexPanel").classList.toggle("hidden",forge.strict);
};

$("#forgeNew").onclick=async()=>{
  const n=Math.min(5,Math.max(1,+$("#forgeCount").value||3));
  $("#forgeArea").innerHTML='<p class="muted">Forging '+n+' sentences...</p>';
  const d=await api("/api/forge/item?difficulty="+ +$("#forgeLevel").value+"&count="+n);
  forgeQueue=(d.items||[d]).slice(0,n);
  forgeQi=0;forgeTotal={xp:0,coins:0,vocab:0};
  playForgeItem();
};

function playForgeItem(){
  const d=forgeQueue[forgeQi];
  forge={item:d,slots:[],idx:0,fails:0,mistakes:0,firstTry:0,t0:Date.now(),strict:forge.strict};
  const words=d.target_text.split(" ");
  let html=`<div class="panel"><p><b>VI:</b> ${d.source_text}</p><div id="forgeSlots">`;
  words.forEach((w,wi)=>{
    html+=`<span class="fword" data-wi="${wi}">`;
    [...w].forEach((ch,ci)=>{
      const given=ci===0;
      forge.slots.push({ch,wi,ci,given,done:given,failed:false});
      html+=`<span class="slot${given?" given":""}" data-si="${forge.slots.length-1}">${given?ch:""}</span>`;
    });
    html+=`</span> `;
  });
  html+=`<div id="forgeAva">▲</div></div><p id="forgeHint" class="muted"></p>
    <p class="muted">Sentence ${forgeQi+1}/${forgeQueue.length} · Target: ${words.length} words · level ${d.difficulty}</p></div>
    <div id="forgeDone"></div>`;
  $("#forgeArea").innerHTML=html;
  const area=$("#forgeSlots");
  area.tabIndex=0;area.focus();
  area.onkeydown=forgeKey;
  area.onclick=()=>area.focus();
  moveAva();
};

function curSlot(){while(forge.idx<forge.slots.length&&forge.slots[forge.idx].done)forge.idx++;return forge.slots[forge.idx];}

function moveAva(){
  const s=curSlot();const ava=$("#forgeAva");if(!ava)return;
  if(!s){ava.style.display="none";return;}
  const el=document.querySelector(`[data-si="${forge.slots.indexOf(s)}"]`);
  if(el){ava.style.display="block";ava.style.left=(el.offsetLeft+el.offsetWidth/2-6)+"px";ava.style.top=(el.offsetTop-20)+"px";}
}

function forgeKey(e){
  if(!forge.item||forge.idx>=forge.slots.length)return;
  if(e.key.length!==1&&e.key!==" ") {if(e.key==="Backspace")e.preventDefault();return;}
  e.preventDefault();
  if(e.key===" ") return; // spaces advance automatically between words
  const s=curSlot();if(!s)return;
  const typed=e.key;
  if(typed.toLowerCase()===s.ch.toLowerCase()){
    s.done=true;
    if(!s.failed)forge.firstTry++;
    forge.fails=0;
    const el=document.querySelector(`[data-si="${forge.slots.indexOf(s)}"]`);
    if(el){el.textContent=s.ch;el.classList.add("ok");}
    forge.idx++;
    const done=forge.slots.filter(x=>x.done).length;
    if(done===forge.slots.length)forgeFinish();
    else moveAva();
  }else{
    s.failed=true;forge.fails++;forge.mistakes++;
    const el=document.querySelector(`[data-si="${forge.slots.indexOf(s)}"]`);
    if(el){el.classList.add("bad");setTimeout(()=>el.classList.remove("bad"),300);}
    if(forge.fails===3){$("#forgeHint").textContent="Hint: the letter is '"+s.ch+"'. Sound it out.";}
    if(forge.fails>=5){s.done=true;forge.fails=0;if(el){el.textContent=s.ch;el.classList.add("hinted");}$("#forgeHint").textContent="";forge.idx++;if(forge.slots.every(x=>x.done))forgeFinish();else moveAva();}
  }
}

let forgeQueue=[],forgeQi=0,forgeTotal={xp:0,coins:0,vocab:0};

async function forgeFinish(){
  const secs=Math.round((Date.now()-forge.t0)/1000);
  const total=forge.slots.filter(s=>!s.given).length||1;
  const acc=forge.firstTry/total;
  const d=await api("/api/forge/complete",{method:"POST",body:JSON.stringify({itemId:forge.item.id,accuracy:+acc.toFixed(3),timeMs:secs*1000,mistakes:forge.mistakes,hintsUsed:0})});
  forgeTotal.xp+=d.xp;forgeTotal.coins+=d.coins;forgeTotal.vocab+=d.vocabAdded;
  forge.idx=forge.slots.length;
  if(forgeQi+1<forgeQueue.length){
    forgeQi++;
    $("#forgeDone").innerHTML=`<div class="card"><h3>SENTENCE ${forgeQi} FORGED ${d.combo?"· "+d.combo:""}</h3>
      <p>Accuracy: ${Math.round(acc*100)}% · +${d.xp} XP · Next sentence loading...</p></div>`;
    setTimeout(playForgeItem,1200);
  }else{
    $("#forgeDone").innerHTML=`<div class="card"><h3>FORGE COMPLETE · ${forgeQueue.length} sentences</h3>
      <p>Last: Accuracy ${Math.round(acc*100)}% · Time ${fmtT(secs*1000)}</p>
      <p><b>Total +${forgeTotal.xp} XP · +${forgeTotal.coins} coins · ${forgeTotal.vocab} words queued</b></p></div>`;
  }
  loadDashboard();
}

$("#forgeFlexBtn").onclick=async()=>{
  const first=(await api("/api/forge/item?difficulty="+ +$("#forgeLevel").value));
  const d=await api("/api/forge/flex",{method:"POST",body:JSON.stringify({itemId:first.id,candidate:$("#forgeFlexText").value})});
  $("#forgeFlexOut").innerHTML=`<div class="card"><p><b>${d.equivalent?"Equivalent":"Not equivalent"}</b> · score ${d.score} · +${d.xp} XP</p><p>${d.feedback||""}</p></div>`;
};
