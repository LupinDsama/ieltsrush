const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
const api=async(path,opt={})=>{const r=await fetch(path,{headers:{"content-type":"application/json"},...opt});const d=await r.json();if(!r.ok)throw Error(d.error||"Request failed");return d};

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
  const d=await api("/api/quests/complete",{method:"POST",body:JSON.stringify({
    total:+$("#qTotal").value,correct:+$("#qCorrect").value,explained:+$("#qExplained").value,fixedOldErrors:+$("#qFixed").value,
    title:"Board quest",kingdom:"mixed"})});
  $("#questResult").textContent=`+${d.xp} XP · +${d.coins} coins · ${d.combo||"no combo"} · accuracy ${Math.round(d.accuracy*100)}%`;
  loadDashboard();
};

$("#genBoss").onclick=async()=>{
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
  const d=await api("/api/paraphrase",{method:"POST",body:JSON.stringify({text:$("#paraText").value})});
  $("#paraOutput").innerHTML=(d.versions||[]).map((v,i)=>`<div class="card"><h3>Version ${i+1}</h3><p>${v.text}</p><p class="muted">${(v.techniques||[]).join(" · ")} - ${v.notes||""}</p></div>`).join("")+
  `<div class="card"><h3>Key changes</h3>${(d.key_changes||[]).map(x=>`<p><b>${x.original}</b> → ${x.replacement}<br>${x.reason}</p>`).join("")}</div>`;
};

$("#writingBtn").onclick=async()=>{
  const d=await api("/api/writing/feedback",{method:"POST",body:JSON.stringify({task:$("#writingTask").value,prompt:$("#writingPrompt").value,answer:$("#writingAnswer").value})});
  $("#writingOutput").innerHTML=`<div class="card"><div class="score">${d.estimated_band||"-"}</div>
  <h3>Estimated band</h3><p class="muted">AI estimate only; not an official IELTS score.</p>
  ${Object.entries(d.criteria||{}).map(([k,v])=>`<p><b>${k}:</b> ${v}</p>`).join("")}
  <h3>Errors</h3>${(d.errors||[]).map(e=>`<p><b>${e.issue}</b><br>${e.quote}<br>→ ${e.fix}</p>`).join("")}
  <h3>Action plan</h3><ul>${(d.action_plan||[]).map(x=>`<li>${x}</li>`).join("")}</ul></div>`;
};

$("#speakingBtn").onclick=async()=>{
  const d=await api("/api/speaking/feedback",{method:"POST",body:JSON.stringify({part:2,transcript:$("#speakingTranscript").value})});
  $("#speakingOutput").innerHTML=`<div class="card"><div class="score">${d.estimated_band||"-"}</div>
  <p>${d.fluency_coherence||""}</p><p>${d.lexical_resource||""}</p><p>${d.grammar||""}</p>
  <p class="muted">${d.pronunciation_note||""}</p><h3>Better phrases</h3><ul>${(d.better_phrases||[]).map(x=>`<li>${x}</li>`).join("")}</ul></div>`;
};
