export interface Env {
  DB: D1Database;
  AI: Ai;
  APP_NAME: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

const id = () => crypto.randomUUID();

async function aiJSON(env: Env, prompt: string) {
  const result: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    prompt,
    response_format: { type: "json_object" }
  });
  const text = typeof result === "string" ? result : result.response ?? JSON.stringify(result);
  return JSON.parse(text);
}

function cors(response: Response) {
  const h = new Headers(response.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "GET,POST,OPTIONS");
  h.set("access-control-allow-headers", "content-type");
  return new Response(response.body, { status: response.status, headers: h });
}

// ---------- Game board / 80-20 / adaptive memory helpers ----------

const SKILL_TARGETS_MIN: Record<string, number> = {
  reading: 8.5, listening: 8.5, writing: 7.5, speaking: 7.5
};
const SKILL_STRETCH: Record<string, number> = {
  reading: 9.0, listening: 9.0, writing: 8.0, speaking: 8.0
};

async function ensureProfile(env: Env, userId: string) {
  let p = await env.DB.prepare("SELECT * FROM profiles WHERE user_id=?").bind(userId).first();
  if (!p) {
    await env.DB.prepare(
      "INSERT INTO profiles(user_id,current_reading,current_listening,current_writing,current_speaking) VALUES(?,?,?,?,?)"
    ).bind(userId, 7.0, 7.5, 6.0, 6.5).run();
    p = await env.DB.prepare("SELECT * FROM profiles WHERE user_id=?").bind(userId).first();
  }
  return p as any;
}

const levelOf = (xp: number) => Math.floor((xp || 0) / 500) + 1;

async function addXP(env: Env, userId: string, xp: number, coins = 0) {
  await ensureProfile(env, userId);
  await env.DB.prepare(
    "UPDATE profiles SET xp = xp + ?, coins = coins + ?, last_active=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE user_id=?"
  ).bind(xp, coins, userId).run();
}

// Priority = Distance to Target x ErrorRate x log(1+attempts)
// Returns sorted weakness list + 80/20 time split suggestion.
async function computePriorities(env: Env, userId: string) {
  const profile = await ensureProfile(env, userId) as any;
  const currents: Record<string, number> = {
    reading: Number(profile.current_reading ?? 6.5),
    listening: Number(profile.current_listening ?? 6.5),
    writing: Number(profile.current_writing ?? 6.0),
    speaking: Number(profile.current_speaking ?? 6.5)
  };
  const rows = await env.DB.prepare(
    "SELECT skill, pattern, attempts, correct FROM error_patterns WHERE user_id=?"
  ).bind(userId).all();
  const items = ((rows.results || []) as any[]).map(r => {
    const skill = String(r.skill).toLowerCase();
    const gap = Math.max(0, (SKILL_TARGETS_MIN[skill] ?? 7.5) - (currents[skill] ?? 6.5));
    const attempts = Number(r.attempts || 0);
    const correct = Number(r.correct || 0);
    const errorRate = attempts > 0 ? 1 - correct / attempts : 0.5;
    const score = gap * errorRate * Math.log(1 + attempts);
    return { skill, pattern: r.pattern, attempts, correct, errorRate, gap, score };
  });
  items.sort((a, b) => b.score - a.score);
  // Persist top items into ai_memory (upsert)
  for (const it of items.slice(0, 20)) {
    const level = it.score > 0.8 ? "CRITICAL" : it.score > 0.4 ? "HIGH" : it.score > 0.15 ? "MEDIUM" : "MAINTAIN";
    await env.DB.prepare(
      `INSERT INTO ai_memory(user_id,memory_type,skill,pattern,confidence,evidence_count,priority,last_seen)
       VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(user_id,skill,pattern) DO UPDATE SET
         confidence=excluded.confidence, evidence_count=excluded.evidence_count,
         priority=excluded.priority, last_seen=CURRENT_TIMESTAMP`
    ).bind(userId, "weakness", it.skill, it.pattern, Number((1 - it.errorRate).toFixed(3)), it.attempts, level).run();
  }
  const mem = await env.DB.prepare(
    "SELECT skill, pattern, priority, evidence_count, confidence FROM ai_memory WHERE user_id=? ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, evidence_count DESC LIMIT 10"
  ).bind(userId).all();
  return {
    currents,
    targetsMin: SKILL_TARGETS_MIN,
    stretch: SKILL_STRETCH,
    overallMin: 8.0,
    overallStretch: 8.5,
    weaknesses: items.slice(0, 10),
    todayPriority: mem.results || [],
    // 80% high-impact / 20% maintenance for a 120-min session
    timeSplit: { highImpactMin: 96, maintenanceMin: 24, totalMin: 120 }
  };
}

const CAMPAIGN_20 = [
  "Day 1 Diagnostic: baseline R/L mock + W/S sample + error log",
  "Day 2 Find weakness: Reading TFNG + paraphrase recognition",
  "Day 3 Find weakness: Listening distractors + spelling + prediction",
  "Day 4 Find weakness: Writing Task 2 thesis + position + paragraph logic",
  "Day 5 Mini Boss: mixed R/L/W checkpoint + AI memory update",
  "Day 6 High-impact: Writing Dungeon (idea development + coherence + Paraphrase Lab)",
  "Day 7 High-impact: Speaking Part 1 + fluency + pronunciation maintenance",
  "Day 8 High-impact: Reading speed + Matching Headings/Information",
  "Day 9 High-impact: Listening Sections 3-4 + academic vocabulary",
  "Day 10 Mid Boss: full Reading + Listening mock (personalized weakest types)",
  "Day 11 Targeted repair: Writing lexical resource + collocations",
  "Day 12 Targeted repair: Writing grammar + complex sentences + Task 1 overview",
  "Day 13 Targeted repair: Speaking lexical chunks + Part 2 expansion",
  "Day 14 Targeted repair: Speaking grammar + Part 3 argument + Task 1 comparisons",
  "Day 15 Full Mock: Task 1 + Task 2 timed + transcript analysis",
  "Day 16 Critical repair: top-3 weakest patterns (adaptive quest)",
  "Day 17 Critical repair: Speaking mock + self-review + Writing rewrite",
  "Day 18 Full 4-skill simulation + targeted repair",
  "Day 19 Final Boss prep: light high-impact review + exam strategy",
  "Day 20 FINAL: full IELTS simulation, 4-skill Boss (R9/L9/W8/S8 stretch)"
];

async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/health") return cors(json({ ok: true, app: env.APP_NAME }));

  if (path === "/api/dashboard") {
    const userId = url.searchParams.get("userId") || "demo-user";
    const days = await env.DB.prepare(
      "SELECT day,date,target,completed FROM study_days WHERE user_id=? ORDER BY day"
    ).bind(userId).all();
    const sets = await env.DB.prepare(
      "SELECT id,topic,level,created_at FROM vocab_sets WHERE user_id=? ORDER BY created_at DESC LIMIT 20"
    ).bind(userId).all();
    const submissions = await env.DB.prepare(
      "SELECT id,task,estimated_band,created_at FROM writing_submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 10"
    ).bind(userId).all();
    const profile = await ensureProfile(env, userId);
    const priorities = await computePriorities(env, userId);
    const quests = await env.DB.prepare(
      "SELECT * FROM quests WHERE user_id=? ORDER BY created_at DESC LIMIT 10"
    ).bind(userId).all().catch(() => ({ results: [] }));
    const achievements = await env.DB.prepare(
      "SELECT code,title,unlocked_at FROM achievements WHERE user_id=? ORDER BY unlocked_at DESC"
    ).bind(userId).all().catch(() => ({ results: [] }));
    return cors(json({
      days: days.results, vocabSets: sets.results, writing: submissions.results,
      profile: { ...(profile as any), level: levelOf((profile as any)?.xp) },
      priorities, quests: (quests as any).results, achievements: (achievements as any).results
    }));
  }

  if (path === "/api/plan/seed" && req.method === "POST") {
    const userId = "demo-user";
    for (let i = 0; i < 20; i++) {
      await env.DB.prepare(
        `INSERT INTO study_days(user_id,day,date,target,completed)
         VALUES(?,?,?,?,0)
         ON CONFLICT(user_id,day) DO UPDATE SET target=excluded.target`
      ).bind(userId, i + 1, null, CAMPAIGN_20[i]).run();
    }
    await ensureProfile(env, userId);
    return cors(json({ ok: true, campaign: "IELTS 8.0 checkpoint / 8.5 stretch: 20 Day Ascension" }));
  }

  if (path === "/api/plan/toggle" && req.method === "POST") {
    const body = await req.json() as any;
    await env.DB.prepare(
      "UPDATE study_days SET completed=? WHERE user_id=? AND day=?"
    ).bind(body.completed ? 1 : 0, body.userId || "demo-user", Number(body.day)).run();
    return cors(json({ ok: true }));
  }

  // ---------- Profile: current levels + targets ----------
  if (path === "/api/profile" && req.method === "GET") {
    const userId = url.searchParams.get("userId") || "demo-user";
    const profile = await ensureProfile(env, userId);
    return cors(json({ ...(profile as any), level: levelOf((profile as any)?.xp) }));
  }

  if (path === "/api/profile" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    await ensureProfile(env, userId);
    await env.DB.prepare(
      `UPDATE profiles SET current_reading=?, current_listening=?, current_writing=?, current_speaking=?,
        updated_at=CURRENT_TIMESTAMP WHERE user_id=?`
    ).bind(
      Number(body.reading ?? 6.5), Number(body.listening ?? 6.5),
      Number(body.writing ?? 6.0), Number(body.speaking ?? 6.5), userId
    ).run();
    const profile = await ensureProfile(env, userId);
    return cors(json({ ...(profile as any), level: levelOf((profile as any)?.xp) }));
  }

  // ---------- 80/20 engine: log attempts, compute priority ----------
  if (path === "/api/attempts/log" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    const skill = String(body.skill || "reading").toLowerCase();
    const qtype = String(body.questionType || body.pattern || "general");
    const correct = body.correct ? 1 : 0;
    await env.DB.prepare(
      "INSERT INTO question_attempts(id,user_id,skill,question_type,correct,time_spent,error_type) VALUES(?,?,?,?,?,?,?)"
    ).bind(id(), userId, skill, qtype, correct, Number(body.timeSpent || 0), body.errorType || null).run();
    // Roll up into error_patterns
    const agg = await env.DB.prepare(
      "SELECT COUNT(*) c, SUM(correct) s FROM question_attempts WHERE user_id=? AND skill=? AND question_type=?"
    ).bind(userId, skill, qtype).first() as any;
    const attempts = Number(agg?.c || 0);
    const okCount = Number(agg?.s || 0);
    const errorRate = attempts ? 1 - okCount / attempts : 0.5;
    const priority = errorRate > 0.4 ? "HIGH" : errorRate > 0.2 ? "MEDIUM" : "MAINTAIN";
    await env.DB.prepare(
      `INSERT INTO error_patterns(user_id,skill,pattern,attempts,correct,priority,updated_at)
       VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(user_id,skill,pattern) DO UPDATE SET attempts=excluded.attempts, correct=excluded.correct, priority=excluded.priority, updated_at=CURRENT_TIMESTAMP`
    ).bind(userId, skill, qtype, attempts, okCount, priority).run();
    const priorities = await computePriorities(env, userId);
    return cors(json({ ok: true, priorities }));
  }

  if (path === "/api/memory/priority" && req.method === "GET") {
    const userId = url.searchParams.get("userId") || "demo-user";
    return cors(json(await computePriorities(env, userId)));
  }

  // ---------- Quests: quality-based XP (anti-spam) ----------
  if (path === "/api/quests/complete" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    // Quality signals: accuracy, explained count, fixed old errors, streak
    const total = Math.max(1, Number(body.total || 1));
    const correctCount = Math.min(total, Math.max(0, Number(body.correct ?? 0)));
    const accuracy = correctCount / total;
    const explained = Math.min(total, Math.max(0, Number(body.explained ?? 0)));
    const fixedOld = Math.max(0, Number(body.fixedOldErrors ?? 0));
    const base = Math.min(200, 5 * total);
    // No reward for blind clicking: accuracy < 40% gives minimal XP
    const qualityMult = accuracy >= 0.9 ? 1.5 : accuracy >= 0.75 ? 1.2 : accuracy >= 0.6 ? 1.0 : accuracy >= 0.4 ? 0.4 : 0.1;
    const explainBonus = Math.round((explained / total) * 40);
    const fixBonus = Math.min(60, fixedOld * 15);
    const streakBonus = Math.min(50, Math.max(0, Number(body.streak || 0)) * 5);
    const xp = Math.round(base * qualityMult + explainBonus + fixBonus + streakBonus);
    const combo = accuracy >= 0.95 && total >= 20 ? "PERFECT RUN x3" : accuracy >= 0.9 && total >= 10 ? "COMBO x3" : accuracy >= 0.8 && total >= 5 ? "COMBO x2" : null;
    const coins = Math.round(xp / 4);
    await addXP(env, userId, xp, coins);
    if (body.questId) {
      await env.DB.prepare("UPDATE quests SET status='done', xp_reward=? WHERE id=?").bind(xp, body.questId).run().catch(() => {});
    } else {
      await env.DB.prepare(
        "INSERT INTO quests(id,user_id,day,kingdom,title,quest_type,impact,status,xp_reward) VALUES(?,?,?,?,?,?,?,?,?)"
      ).bind(id(), userId, Number(body.day || 0), body.kingdom || "general", body.title || "Quest", body.questType || "practice", accuracy < 0.4 ? "LOW" : "HIGH", "done", xp).run().catch(() => {});
    }
    // Achievements: simple thresholds
    const profile = await ensureProfile(env, userId) as any;
    if (Number(profile.xp) >= 1000) {
      await env.DB.prepare("INSERT INTO achievements(id,user_id,code,title) VALUES(?,?,?,?) ON CONFLICT(user_id,code) DO NOTHING")
        .bind(id(), userId, "xp-1000", "1000 XP Scholar").run().catch(() => {});
    }
    return cors(json({ ok: true, xp, coins, accuracy, combo, explainBonus, fixBonus }));
  }

  // ---------- Personalized Boss (uses weakest patterns, not random) ----------
  if (path === "/api/boss/generate" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    const day = Number(body.day || 10);
    const priorities = await computePriorities(env, userId);
    const focus = (priorities.weaknesses || []).slice(0, 3);
    const spec = {
      title: focus.length ? `Personalized Boss: ${focus.map((f: any) => f.pattern).join(" + ")}` : "Mixed-skills Boss",
      day, kind: body.kind || "mixed",
      questions: 40, minutes: 60,
      focus,
      maintenance: (priorities.weaknesses || []).slice(3, 5)
    };
    await env.DB.prepare(
      "INSERT INTO boss_battles(id,user_id,day,kind,focus_json,score_before) VALUES(?,?,?,?,?,?)"
    ).bind(id(), userId, day, spec.kind, JSON.stringify(spec), Number(body.scoreBefore || 0)).run().catch(() => {});
    return cors(json(spec));
  }

  // ---------- Vocabulary inventory + spaced repetition ----------
  if (path === "/api/flashcard/review" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    const vocabId = String(body.vocabId || "");
    const correct = body.correct ? 1 : 0;
    // Simple SM-2-like ladder: 1 -> 2 -> 4 -> 8 -> 13 -> 20
    const ladder = [1, 2, 4, 8, 13, 20];
    const last = await env.DB.prepare(
      "SELECT next_review_day FROM flashcard_reviews WHERE vocab_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1"
    ).bind(vocabId, userId).first().catch(() => null) as any;
    let next = correct ? 2 : 1;
    if (last) {
      const idx = ladder.indexOf(Number(last.next_review_day));
      next = correct ? ladder[Math.min(ladder.length - 1, (idx < 0 ? 0 : idx + 1))] : 1;
    }
    await env.DB.prepare(
      "INSERT INTO flashcard_reviews(id,vocab_id,user_id,correct,next_review_day) VALUES(?,?,?,?,?)"
    ).bind(id(), vocabId, userId, correct, next).run();
    if (correct) await addXP(env, userId, 5, 1);
    return cors(json({ ok: true, nextReviewDay: next }));
  }

  if (path === "/api/vocab/generate" && req.method === "POST") {
    const body = await req.json() as any;
    const topic = String(body.topic || "Education");
    const count = Math.min(Math.max(Number(body.count || 100), 1), 100);
    const prompt = `You are an IELTS Academic vocabulary teacher.
Return ONLY valid JSON:
{"words":[{"word":"","pos":"","definition":"","meaning_vi":"","example":"","collocations":[""],"synonyms":[""],"difficulty":1}]}
Generate exactly ${count} useful B2-C1/C2 vocabulary items for the topic "${topic}".
Avoid obscure words. Prefer words that can be used naturally in IELTS Reading, Listening, Writing and Speaking.
Examples must be original and concise. Do not copy source text.`;
    const data = await aiJSON(env, prompt);
    const setId = id();
    await env.DB.prepare(
      "INSERT INTO vocab_sets(id,user_id,topic,level) VALUES(?,?,?,?)"
    ).bind(setId, "demo-user", topic, "B2-C1").run();

    for (const w of data.words || []) {
      await env.DB.prepare(
        `INSERT INTO vocabulary(id,set_id,word,pos,definition,meaning_vi,example,collocations,synonyms,difficulty)
         VALUES(?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id(), setId, w.word, w.pos, w.definition, w.meaning_vi, w.example,
        JSON.stringify(w.collocations || []), JSON.stringify(w.synonyms || []),
        Number(w.difficulty || 3)
      ).run();
    }

    // Automatically generate a review quiz from the generated set.
    const quizPrompt = `Create 20 IELTS vocabulary multiple-choice questions using these words:
${JSON.stringify(data.words || [])}
Return ONLY JSON:
{"questions":[{"question":"","options":["A","B","C","D"],"answer":"A","explanation":""}]}
Test meaning in context, collocations, synonym recognition and usage.`;
    const quiz = await aiJSON(env, quizPrompt);
    for (const q of quiz.questions || []) {
      await env.DB.prepare(
        "INSERT INTO quiz_questions(id,set_id,question,options_json,answer,explanation) VALUES(?,?,?,?,?,?)"
      ).bind(id(), setId, q.question, JSON.stringify(q.options), q.answer, q.explanation).run();
    }

    return cors(json({ setId, topic, words: data.words, questions: quiz.questions || [] }));
  }

  if (path === "/api/vocab/set" && req.method === "GET") {
    const setId = url.searchParams.get("id");
    if (!setId) return cors(json({ error: "Missing id" }, 400));
    const set = await env.DB.prepare("SELECT * FROM vocab_sets WHERE id=?").bind(setId).first();
    const words = await env.DB.prepare("SELECT * FROM vocabulary WHERE set_id=? ORDER BY word").bind(setId).all();
    const questions = await env.DB.prepare("SELECT * FROM quiz_questions WHERE set_id=?").bind(setId).all();
    return cors(json({ set, words: words.results, questions: questions.results }));
  }

  if (path === "/api/paraphrase" && req.method === "POST") {
    const body = await req.json() as any;
    const original = String(body.text || "").slice(0, 5000);
    const prompt = `You are an IELTS paraphrasing coach.
Return ONLY JSON:
{"versions":[{"text":"","techniques":[""],"notes":""}],"key_changes":[{"original":"","replacement":"","reason":""}]}
Paraphrase this text naturally at IELTS Band 7-8 level. Preserve meaning. Show 3 versions:
1) vocabulary substitution,
2) grammatical transformation,
3) mixed transformation.
Do not invent facts.
TEXT:
${original}`;
    const result = await aiJSON(env, prompt);
    await env.DB.prepare(
      "INSERT INTO paraphrases(id,user_id,original_text,paraphrase,technique,notes) VALUES(?,?,?,?,?,?)"
    ).bind(
      id(), "demo-user", original, JSON.stringify(result.versions || []),
      "vocabulary + grammar + mixed", JSON.stringify(result.key_changes || [])
    ).run();
    return cors(json(result));
  }

  if (path === "/api/writing/feedback" && req.method === "POST") {
    const body = await req.json() as any;
    const task = body.task === "task1" ? "Task 1" : "Task 2";
    const answer = String(body.answer || "").slice(0, 12000);
    const prompt = `Act as an IELTS writing assessor and coach.
Use the four public IELTS criteria: Task Achievement/Task Response, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy.
Return ONLY JSON:
{"estimated_band":0,"criteria":{"task":"","coherence":"","lexical":"","grammar":""},"errors":[{"quote":"","issue":"","fix":""}],"action_plan":[""],"improved_excerpt":""}
Be conservative: this is an estimate, not an official score. Explain what evidence supports the estimate.
Task: ${task}
Question/context: ${String(body.prompt || "").slice(0,4000)}
Candidate answer:
${answer}`;
    const result = await aiJSON(env, prompt);
    const submissionId = id();
    await env.DB.prepare(
      "INSERT INTO writing_submissions(id,user_id,prompt_id,task,answer,estimated_band,feedback_json) VALUES(?,?,?,?,?,?,?)"
    ).bind(
      submissionId, "demo-user", body.promptId || null, task, answer,
      Number(result.estimated_band || 0), JSON.stringify(result)
    ).run();
    return cors(json({ id: submissionId, ...result }));
  }

  if (path === "/api/speaking/feedback" && req.method === "POST") {
    const body = await req.json() as any;
    const transcript = String(body.transcript || "").slice(0, 10000);
    const prompt = `You are an IELTS Speaking coach.
Return ONLY JSON:
{"estimated_band":0,"fluency_coherence":"","lexical_resource":"","grammar":"","pronunciation_note":"Transcript cannot fully measure pronunciation.","better_phrases":[],"follow_up_questions":[]}
Estimate from the transcript only. Do not pretend to hear pronunciation.
Transcript:
${transcript}`;
    const result = await aiJSON(env, prompt);
    await env.DB.prepare(
      "INSERT INTO speaking_sessions(id,user_id,part,topic,transcript,feedback_json) VALUES(?,?,?,?,?,?)"
    ).bind(id(), "demo-user", Number(body.part || 2), body.topic || "", transcript, JSON.stringify(result)).run();
    return cors(json(result));
  }

  if (path === "/api/sources" && req.method === "POST") {
    // Safe source registry: store URL + metadata; don't automatically copy full copyrighted pages.
    const body = await req.json() as any;
    await env.DB.prepare(
      `INSERT INTO source_items(id,title,url,source_name,source_type,license_note,content_excerpt)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(url) DO UPDATE SET title=excluded.title,license_note=excluded.license_note`
    ).bind(
      id(), body.title || "", body.url, body.sourceName || "",
      body.sourceType || "public", body.licenseNote || "",
      String(body.excerpt || "").slice(0, 2000)
    ).run();
    return cors(json({ ok: true }));
  }

  if (path === "/api/writing/prompts" && req.method === "GET") {
    const task = url.searchParams.get("task");
    const stmt = task
      ? env.DB.prepare("SELECT * FROM writing_prompts WHERE task=? ORDER BY created_at DESC").bind(task)
      : env.DB.prepare("SELECT * FROM writing_prompts ORDER BY created_at DESC");
    const rows = await stmt.all();
    return cors(json(rows.results));
  }

  return cors(json({ error: "Not found" }, 404));
}

export default {
  async fetch(req: Request, env: Env) {
    try { return await handle(req, env); }
    catch (e: any) { return cors(json({ error: e?.message || "Server error" }, 500)); }
  }
};
