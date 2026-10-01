export interface Env {
  DB: D1Database;
  AI: Ai;
  APP_NAME: string;
  AI_API_KEY?: string;
  AI_API_KEY_2?: string;
  AI_API_KEY_3?: string;
  AI_API_BASE?: string;
  AI_MODEL?: string;
  CF_MODEL?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

const id = () => crypto.randomUUID();

function geminiText(obj: any): string {
  const parts = obj?.candidates?.[0]?.content?.parts || [];
  return parts.map((p: any) => p.text || "").join("");
}

function stripFences(s: string): string {
  const closed = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (closed) return closed[1].trim();
  const unclosed = s.match(/```(?:json)?\s*([\s\S]*)/i);
  return (unclosed ? unclosed[1] : s).trim();
}

function closeJson(s: string): string | null {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "{") stack.push("}");
      else if (ch === "[") stack.push("]");
      else if (ch === "}" || ch === "]") {
        if (stack.length === 0) return null;
        stack.pop();
      }
    }
  }
  if (inStr) return null;
  // Drop a dangling trailing fragment like ,"key": or a bare : / ,
  const body = s.replace(/,\s*"[^"]*"\s*:?\s*$/, "").replace(/[:,]\s*$/, "");
  if (body !== s) return closeJson(body);
  return s + stack.reverse().join("");
}

export function parseModelJSON(raw: unknown): any {
  const text = stripFences(typeof raw === "string" ? raw : (raw as any)?.response ?? JSON.stringify(raw));
  const candidates: string[] = [text];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  const repaired = closeJson(text.replace(/,\s*([}\]])/g, "$1"));
  if (repaired && repaired !== text && !candidates.includes(repaired)) candidates.push(repaired);
  let lastErr: any = new Error("no JSON object found");
  for (const c of candidates) {
    try { return JSON.parse(c); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

class AIConfigError extends Error {}

// All configured Gemini keys (trimmed, non-empty). Secrets only, never committed.
export function apiKeys(env: Env): string[] {
  return [env.AI_API_KEY, env.AI_API_KEY_2, env.AI_API_KEY_3]
    .map(k => (k || "").trim())
    .filter(k => k.length > 0);
}

let keyCursor = 0;

async function geminiAttempt(base: string, model: string, key: string, prompt: string) {
  const ctrl = AbortSignal.timeout(25000);
  const res = await fetch(`${base}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    }),
    signal: ctrl
  });
  if (!res.ok) {
    let detail = "";
    try { detail = String((await res.clone().json() as any)?.error?.message || ""); } catch { /* ignore */ }
    if (res.status === 401 || res.status === 403) {
      throw new AIConfigError(`AI API ${res.status}: ${detail.slice(0, 160)}`);
    }
    if (res.status === 400 && !/location is not supported/i.test(detail)) {
      throw new AIConfigError(`AI API 400: ${detail.slice(0, 160)}`);
    }
    // 429/5xx + region blocks + bad payloads: try next key, then Workers AI.
    throw new Error(`AI API ${res.status}: ${detail.slice(0, 120)}`);
  }
  const rawText = geminiText(await res.json());
  try {
    return parseModelJSON(rawText);
  } catch {
    const err = new Error("AI returned non-JSON");
    (err as any).snippet = String(rawText).slice(0, 120);
    throw err;
  }
}

async function geminiJSON(env: Env, prompt: string) {
  const keys = apiKeys(env);
  const base = (env.AI_API_BASE || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const model = env.AI_MODEL || "gemini-3.8-flash";
  let lastErr: any = new Error("no API keys configured");
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(keyCursor + i) % keys.length];
    try {
      const out = await geminiAttempt(base, model, key, prompt);
      keyCursor = (keyCursor + i + 1) % keys.length;
      return out;
    } catch (e) {
      if (e instanceof AIConfigError) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

async function aiJSON(env: Env, prompt: string) {
  // Primary: external Gemini-compatible API keys via secrets (never committed).
  // Retryable failures rotate to the next key, then fall back to Workers AI.
  if (apiKeys(env).length > 0) {
    try {
      return await geminiJSON(env, prompt);
    } catch (e) {
      console.error("AIDBG gemini failed:", (e as Error)?.message, "snippet:", String((e as any)?.snippet || "").slice(0, 80));
      if (e instanceof AIConfigError || !env.AI) throw e;
    }
  }
  // Fallback: Cloudflare Workers AI binding (retry once: small models flake).
  let lastErr: any = new Error("AI binding failed");
  for (let attempt = 0; attempt < 2; attempt++) {
    let result: any;
    try {
      result = await env.AI.run((env.CF_MODEL || "@cf/meta/llama-3.1-8b-instruct-fp8") as any, {
        prompt,
        response_format: { type: "json_object" },
        max_tokens: 2048
      } as any);
    } catch (e) { lastErr = e; continue; }
    const rawText = typeof result === "string" ? result : result.response ?? JSON.stringify(result);
    try {
      return parseModelJSON(rawText);
    } catch (e) {
      lastErr = e;
      console.error("AIDBG binding bad json (try " + attempt + "):", (e as Error)?.message, "len:", String(rawText).length, "tail:", String(rawText).slice(-120));
    }
  }
  throw new Error("AI binding returned non-JSON");
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

async function unlock(env: Env, userId: string, code: string, title: string) {
  await env.DB.prepare(
    "INSERT INTO achievements(id,user_id,code,title) VALUES(?,?,?,?) ON CONFLICT(user_id,code) DO NOTHING"
  ).bind(id(), userId, code, title).run().catch(() => {});
}

const levelOf = (xp: number) => Math.floor((xp || 0) / 500) + 1;

async function addXP(env: Env, userId: string, xp: number, coins = 0) {
  await ensureProfile(env, userId);
  await env.DB.prepare(
    "UPDATE profiles SET xp = xp + ?, coins = coins + ?, last_active=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE user_id=?"
  ).bind(xp, coins, userId).run();
}

// ---------- Spec section 6: normalized 5-component 80/20 priority ----------
// priority = gap_to_target * error_rate * frequency * score_impact * recency (all 0-1)
const SCORE_IMPACT: Record<string, number> = {
  "tfng": 0.9, "t/f/ng": 0.9, "true/false/not given": 0.9,
  "y/n/ng": 0.85, "yes/no/not given": 0.85,
  "matching headings": 0.9, "headings": 0.85, "matching information": 0.85,
  "matching features": 0.8, "matching": 0.8, "matching sentence endings": 0.75,
  "multiple choice": 0.7, "mcq": 0.7, "map": 0.75, "matching map": 0.75,
  "sentence completion": 0.7, "summary completion": 0.75, "table completion": 0.7,
  "form completion": 0.7, "note completion": 0.7, "flow-chart completion": 0.7,
  "diagram labelling": 0.7, "diagram label": 0.7, "short-answer": 0.65,
  "spelling": 0.8, "numbers": 0.7, "names": 0.65, "distractors": 0.85, "prediction": 0.7,
  "section 3": 0.85, "section 4": 0.9, "academic vocabulary": 0.8,
  "paraphrase": 0.9, "paraphrase recognition": 0.9, "reading speed": 0.6,
  "thesis": 0.9, "task response": 0.95, "coherence": 0.85, "cohesion": 0.8,
  "lexical resource": 0.85, "grammar": 0.85, "overview": 0.8, "comparison": 0.75,
  "fluency": 0.85, "pronunciation": 0.8, "idea development": 0.85
};

function impactOf(pattern: string): number {
  const p = pattern.toLowerCase();
  if (p in SCORE_IMPACT) return SCORE_IMPACT[p];
  for (const k of Object.keys(SCORE_IMPACT)) {
    if (p.includes(k) || k.includes(p)) return SCORE_IMPACT[k];
  }
  return 0.5;
}

async function computePrioritiesV2(env: Env, userId: string) {
  const base = await computePriorities(env, userId);
  const rows = await env.DB.prepare(
    "SELECT skill, pattern, attempts, correct, updated_at FROM error_patterns WHERE user_id=?"
  ).bind(userId).all();
  const now = Date.now();
  const items = ((rows.results || []) as any[]).map(r => {
    const skill = String(r.skill).toLowerCase();
    const gap = Math.min(1, Math.max(0, ((SKILL_TARGETS_MIN[skill] ?? 7.5) - (base.currents[skill] ?? 6.5)) / 3));
    const attempts = Number(r.attempts || 0);
    const correct = Number(r.correct || 0);
    const errorRate = attempts > 0 ? 1 - correct / attempts : 0.5;
    const frequency = Math.min(1, attempts / 20);
    const impact = impactOf(String(r.pattern));
    const daysSince = Math.max(0, (now - new Date(String(r.updated_at || new Date().toISOString())).getTime()) / 86400000);
    const recency = Math.max(0.2, 1 - daysSince / 14);
    const score = gap * errorRate * frequency * impact * recency;
    return { skill, pattern: r.pattern, attempts, correct, errorRate, gap, frequency, impact, recency, score };
  });
  items.sort((a, b) => b.score - a.score);
  for (const it of items.slice(0, 20)) {
    const level = it.score > 0.25 ? "CRITICAL" : it.score > 0.12 ? "HIGH" : it.score > 0.05 ? "MEDIUM" : "MAINTAIN";
    await env.DB.prepare(
      `INSERT INTO ai_memory(user_id,memory_type,skill,pattern,confidence,evidence_count,priority,last_seen)
       VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(user_id,skill,pattern) DO UPDATE SET
         confidence=excluded.confidence, evidence_count=excluded.evidence_count,
         priority=excluded.priority, last_seen=CURRENT_TIMESTAMP`
    ).bind(userId, "weakness", it.skill, it.pattern, Number((1 - it.errorRate).toFixed(3)), it.attempts, level).run();
  }
  return { ...base, components: items.slice(0, 10) };
}

// Spec section 23: build next-best actions from evidence.
async function buildNextActions(env: Env, userId: string) {
  const p = await computePrioritiesV2(env, userId);
  const weak = (p.components || []).filter((w: any) => w.score > 0.03).slice(0, 3);
  const actions = weak.map((w: any, i: number) => {
    const n = w.skill === "reading" || w.skill === "listening" ? 10 : 5;
    const kind = /vocab|paraphrase|lexical|collocation/i.test(w.pattern) ? "drills" : "questions";
    return {
      rank: i + 1,
      action: `${n} ${w.pattern} ${kind} (${w.skill})`,
      reason: `gap ${w.gap.toFixed(2)}, error ${(w.errorRate * 100).toFixed(0)}%, impact ${w.impact}`,
      minutes: w.skill === "reading" || w.skill === "listening" ? 8 : 6
    };
  });
  if (actions.length) {
    actions.push({ rank: actions.length + 1, action: "Review 8 weak vocabulary items", reason: "spaced repetition queue", minutes: 6 });
  }
  await env.DB.prepare("DELETE FROM next_actions WHERE user_id=?").bind(userId).run().catch(() => {});
  for (const a of actions) {
    await env.DB.prepare(
      "INSERT INTO next_actions(id,user_id,rank,action,reason) VALUES(?,?,?,?,?)"
    ).bind(id(), userId, a.rank, a.action, a.reason).run().catch(() => {});
  }
  const totalMin = actions.reduce((s: number, a: any) => s + a.minutes, 0);
  return { actions, estimatedMinutes: totalMin };
}

async function ensureForgeSet(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT id FROM vocab_sets WHERE user_id=? AND topic=? ORDER BY created_at DESC LIMIT 1"
  ).bind(userId, "Forge").first().catch(() => null) as any;
  if (row?.id) return row.id;
  const setId = id();
  await env.DB.prepare("INSERT INTO vocab_sets(id,user_id,topic,level) VALUES(?,?,?,?)")
    .bind(setId, userId, "Forge", "B2-C1").run();
  return setId;
}

// Spec section 21 checkpoints: Day 0/1/3/6/10/15/20.
const REVIEW_LADDER = [0, 1, 3, 6, 10, 15, 20];
function reviewDate(base: Date, dayOffset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}
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
      "INSERT INTO question_attempts(id,user_id,skill,question_type,correct,time_spent,error_type,question_id,quest_id,user_answer,correct_answer,time_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(id(), userId, skill, qtype, correct, Number(body.timeSpent || 0), body.errorType || null, body.questionId || null, body.questId || null, body.userAnswer ? String(body.userAnswer).slice(0, 500) : null, body.correctAnswer ? String(body.correctAnswer).slice(0, 500) : null, Number(body.timeMs || 0)).run().catch(async () => {
      await env.DB.prepare(
        "INSERT INTO question_attempts(id,user_id,skill,question_type,correct,time_spent,error_type) VALUES(?,?,?,?,?,?,?)"
      ).bind(id(), userId, skill, qtype, correct, Number(body.timeSpent || 0), body.errorType || null).run();
    });
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
    const priorities = await computePrioritiesV2(env, userId);
    return cors(json({ ok: true, priorities }));
  }

  if (path === "/api/memory/priority" && req.method === "GET") {
    const userId = url.searchParams.get("userId") || "demo-user";
    return cors(json(await computePrioritiesV2(env, userId)));
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
    const quizN = Math.min(20, Math.max(5, Math.round(count / 5)));
    // Chunked parallel generation: small outputs stream faster and parse more
    // reliably, and chunks spread across the API key ring (Promise.all).
    // One bad chunk no longer kills the batch (allSettled).
    const CHUNK = 15;
    const chunks = Math.max(1, Math.ceil(count / CHUNK));
    const perChunk = Math.floor(count / chunks);
    const quizPer = Math.max(1, Math.round(quizN / chunks));
    const mkPrompt = (n: number, q: number) => `You are an IELTS Academic vocabulary teacher.
Return ONLY valid JSON:
{"words":[{"word":"","pos":"","definition":"","meaning_vi":"","example":"","collocations":[""],"synonyms":[""],"difficulty":1}],"questions":[{"question":"","options":["A","B","C","D"],"answer":"A","explanation":""}]}
Generate exactly ${n} useful B2-C1/C2 vocabulary items for the topic "${topic}".
Avoid obscure words. Prefer words that can be used naturally in IELTS Reading, Listening, Writing and Speaking.
Examples must be original and concise. Do not copy source text.
Then create exactly ${q} multiple-choice questions from those words, testing meaning in context, collocations, synonym recognition and usage.`;
    const settled = await Promise.allSettled(
      Array.from({ length: chunks }, (_, i) => {
        const n = i === chunks - 1 ? count - perChunk * (chunks - 1) : perChunk;
        return aiJSON(env, mkPrompt(n, quizPer));
      })
    );
    const results = settled.filter(s => s.status === "fulfilled").map(s => (s as PromiseFulfilledResult<any>).value);
    const words = results.flatMap(r => r.words || []);
    const questions = results.flatMap(r => r.questions || []).slice(0, quizN);
    if (!words.length) {
      const reason = settled.find(s => s.status === "rejected") as PromiseRejectedResult | undefined;
      return cors(json({ error: "AI vocabulary generation failed: " + String(reason?.reason?.message || reason?.reason || "unknown") }, 502));
    }
    const setId = id();
    const stmts: any[] = [
      env.DB.prepare("INSERT INTO vocab_sets(id,user_id,topic,level) VALUES(?,?,?,?)").bind(setId, "demo-user", topic, "B2-C1")
    ];
    for (const w of words) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO vocabulary(id,set_id,word,pos,definition,meaning_vi,example,collocations,synonyms,difficulty)
           VALUES(?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          id(), setId, w.word, w.pos, w.definition, w.meaning_vi, w.example,
          JSON.stringify(w.collocations || []), JSON.stringify(w.synonyms || []),
          Number(w.difficulty || 3)
        )
      );
    }
    for (const q of questions) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO quiz_questions(id,set_id,question,options_json,answer,explanation) VALUES(?,?,?,?,?,?)"
        ).bind(id(), setId, q.question, JSON.stringify(q.options), q.answer, q.explanation)
      );
    }
    if (typeof (env.DB as any).batch === "function") {
      await (env.DB as any).batch(stmts);
    } else {
      for (const s of stmts) await s.run();
    }

    return cors(json({ setId, topic, words, questions }));
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

  // ---------- Spec section 2+24: official source registry with attribution ----------
  if (path === "/api/sources/seed" && req.method === "POST") {
    const official = [
      { title: "IELTS Academic sample questions", name: "IELTS", url: "https://www.ielts.org/take-a-test/preparation-resources/sample-test-questions/academic-test", type: "official", test: "academic", section: "all", license: "Official IELTS sample material; use on-site with attribution." },
      { title: "IELTS General Training sample questions", name: "IELTS", url: "https://www.ielts.org/take-a-test/preparation-resources/sample-test-questions/general-training-test", type: "official", test: "general", section: "all", license: "Official IELTS sample material; use on-site with attribution." },
      { title: "Understanding IELTS scoring", name: "IELTS", url: "https://ielts.org/organisations/ielts-for-organisations/understanding-ielts-scoring/resources-for-setting-your-ielts-scores", type: "official", test: "scoring", section: "band Descriptors", license: "Official scoring resources; reference only." }
    ];
    for (const s of official) {
      await env.DB.prepare(
        `INSERT INTO sources(id,title,source_name,url,source_type,test_type,section,license_note)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(url) DO UPDATE SET title=excluded.title,license_note=excluded.license_note`
      ).bind(id(), s.title, s.name, s.url, s.type, s.test, s.section, s.license).run();
    }
    return cors(json({ ok: true, seeded: official.length }));
  }

  if (path === "/api/sources" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM sources ORDER BY date_added DESC").bind().all().catch(() => ({ results: [] }));
    return cors(json((rows as any).results || []));
  }

  // ---------- Spec section 10+25: question bank (keys never leave the server) ----------
  if (path === "/api/questions" && req.method === "POST") {
    const body = await req.json() as any;
    if (!body.answer) return cors(json({ error: "answer key required" }, 400));
    const qid = id();
    await env.DB.prepare(
      `INSERT INTO questions(id,source_id,skill,section,question_type,prompt,options_json,answer,explanation,difficulty)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      qid, body.sourceId || null, String(body.skill || "reading").toLowerCase(),
      body.section || null, body.questionType || "general", body.prompt || "",
      JSON.stringify(body.options || []), String(body.answer),
      body.explanation || null, Math.min(5, Math.max(1, Number(body.difficulty || 1)))
    ).run();
    return cors(json({ id: qid }));
  }

  if (path === "/api/questions" && req.method === "GET") {
    const skill = url.searchParams.get("skill");
    const type = url.searchParams.get("type");
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 10)));
    let stmt: any = env.DB.prepare("SELECT id,skill,section,question_type,prompt,options_json,explanation,difficulty,created_at FROM questions ORDER BY created_at DESC LIMIT ?").bind(limit);
    if (skill && type) stmt = env.DB.prepare("SELECT id,skill,section,question_type,prompt,options_json,explanation,difficulty,created_at FROM questions WHERE skill=? AND question_type=? ORDER BY created_at DESC LIMIT ?").bind(skill.toLowerCase(), type, limit);
    else if (skill) stmt = env.DB.prepare("SELECT id,skill,section,question_type,prompt,options_json,explanation,difficulty,created_at FROM questions WHERE skill=? ORDER BY created_at DESC LIMIT ?").bind(skill.toLowerCase(), limit);
    const rows = await stmt.all().catch(() => ({ results: [] }));
    return cors(json((rows as any).results || []));
  }

  // ---------- Spec Definition of Done 1-3: Day 1 diagnostic -> 80/20 profile ----------
  if (path === "/api/diagnostic/submit" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    if (body.bands) {
      await ensureProfile(env, userId);
      await env.DB.prepare(
        "UPDATE profiles SET current_reading=?, current_listening=?, current_writing=?, current_speaking=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?"
      ).bind(
        Number(body.bands.reading ?? 6.5), Number(body.bands.listening ?? 6.5),
        Number(body.bands.writing ?? 6.0), Number(body.bands.speaking ?? 6.5), userId
      ).run();
    }
    for (const r of body.results || []) {
      const skill = String(r.skill || "reading").toLowerCase();
      const pattern = String(r.questionType || "general");
      const total = Math.max(0, Number(r.total || 0));
      const correct = Math.min(total, Math.max(0, Number(r.correct || 0)));
      const prev = await env.DB.prepare(
        "SELECT attempts, correct FROM error_patterns WHERE user_id=? AND skill=? AND pattern=?"
      ).bind(userId, skill, pattern).first().catch(() => null) as any;
      const attempts = Number(prev?.attempts || 0) + total;
      const okCount = Number(prev?.correct || 0) + correct;
      await env.DB.prepare(
        `INSERT INTO error_patterns(user_id,skill,pattern,attempts,correct,priority,updated_at)
         VALUES(?,?,?,?,?,'MEDIUM',CURRENT_TIMESTAMP)
         ON CONFLICT(user_id,skill,pattern) DO UPDATE SET attempts=excluded.attempts, correct=excluded.correct, updated_at=CURRENT_TIMESTAMP`
      ).bind(userId, skill, pattern, attempts, okCount).run();
    }
    const priorities = await computePrioritiesV2(env, userId);
    const profile = await ensureProfile(env, userId);
    const next = await buildNextActions(env, userId);
    await unlock(env, userId, "diagnostic", "Diagnostic complete");
    return cors(json({ profile, priorities, nextBest: next }));
  }

  // ---------- Spec section 8: quest generation from D1 evidence (never random) ----------
  if (path === "/api/quests/generate" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    const day = Number(body.day || 1);
    const p = await computePrioritiesV2(env, userId);
    const top = (p.components || [])[0] as any;
    let nodeType = "skill", skill = top?.skill || "reading", pattern = top?.pattern || "general";
    let title = `${pattern} Drill`;
    const pl = pattern.toLowerCase();
    if (/vocab|lexical|collocation/.test(pl)) { nodeType = "vocabulary"; title = "Vocabulary Vault"; }
    else if (/paraphrase/.test(pl)) { nodeType = "paraphrase"; title = "Paraphrase Hunter"; }
    else if (/tfng|t\/f\/ng|not given/.test(pl)) { nodeType = "skill"; title = "TFNG Hunt"; }
    else if (/distract/.test(pl)) { nodeType = "skill"; title = "Listening Distractor Trap"; }
    else if (/thesis|task response/.test(pl)) { nodeType = "skill"; title = "Thesis Builder"; }
    else if (/fluen|speaking|part/.test(pl)) { nodeType = "skill"; title = "Speaking Expansion"; }
    if (day === 5) { nodeType = "mini"; title = "Mini Boss Checkpoint"; }
    if (day === 10 || day === 15) { nodeType = "boss"; title = day === 10 ? "Mid Boss" : "Full Mock Boss"; }
    if (day === 20) { nodeType = "final"; title = "Final Boss: Full Simulation"; }
    if (day === 1) { nodeType = "diagnostic"; title = "Day 1 Diagnostic"; skill = "mixed"; }
    const bank = await env.DB.prepare(
      "SELECT id,skill,section,question_type,prompt,options_json,explanation,difficulty FROM questions WHERE skill=? AND question_type=? ORDER BY created_at DESC LIMIT 20"
    ).bind(skill, pattern).all().catch(() => ({ results: [] }));
    let questions = ((bank as any).results || []) as any[];
    if (!questions.length && skill !== "mixed") {
      const anySkill = await env.DB.prepare(
        "SELECT id,skill,section,question_type,prompt,options_json,explanation,difficulty FROM questions WHERE skill=? ORDER BY created_at DESC LIMIT 20"
      ).bind(skill).all().catch(() => ({ results: [] }));
      questions = ((anySkill as any).results || []) as any[];
    }
    const qid = id();
    await env.DB.prepare(
      "INSERT INTO quests(id,user_id,day,kingdom,title,quest_type,impact,status,skill,difficulty,priority) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(qid, userId, day, skill, title, nodeType, top && top.score > 0.12 ? "HIGH" : "MEDIUM", "unlocked", skill, Math.min(3, Math.max(1, Math.round(1 + (top?.errorRate || 0.5) * 2))), Number((top?.score || 0.1).toFixed(4))).run().catch(() => {});
    return cors(json({ quest: { id: qid, day, type: nodeType, skill, title }, questions, needsContent: questions.length === 0, evidence: top || null }));
  }

  if (path === "/api/writing/prompts" && req.method === "GET") {
    const task = url.searchParams.get("task");
    const stmt = task
      ? env.DB.prepare("SELECT * FROM writing_prompts WHERE task=? ORDER BY created_at DESC").bind(task)
      : env.DB.prepare("SELECT * FROM writing_prompts ORDER BY created_at DESC");
    const rows = await stmt.all();
    return cors(json(rows.results));
  }

  // ---------- Spec section 9+29+30: timed quest start (warnings + durations) ----------
  if (path === "/api/quest/start" && req.method === "POST") {
    const body = await req.json() as any;
    const quest = await env.DB.prepare("SELECT * FROM quests WHERE id=?").bind(body.questId || "").first() as any;
    if (!quest) return cors(json({ error: "quest not found" }, 404));
    const durations: Record<string, number> = { normal: 15, skill: 15, vocabulary: 10, paraphrase: 10, review: 10, diagnostic: 20, mini: 20, boss: 30, final: 150 };
    const durationMin = durations[quest.quest_type] ?? 15;
    const qs = await env.DB.prepare(
      "SELECT id,skill,section,question_type,prompt,options_json,explanation,difficulty FROM questions WHERE skill=? ORDER BY created_at DESC LIMIT 20"
    ).bind(quest.skill || quest.kingdom || "reading").all().catch(() => ({ results: [] }));
    return cors(json({
      quest: { id: quest.id, day: quest.day, type: quest.quest_type, skill: quest.skill || quest.kingdom, title: quest.title },
      questions: ((qs as any).results || []) as any[],
      startedAt: new Date().toISOString(),
      durationMin,
      warnings: [50, 75, 90, 100]
    }));
  }

  // ---------- Spec section 10+23+28: objective scoring, progression, direction ----------
  if (path === "/api/quest/submit" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    const quest = await env.DB.prepare("SELECT * FROM quests WHERE id=?").bind(body.questId || "").first() as any;
    if (!quest) return cors(json({ error: "quest not found" }, 404));
    const answers = (body.answers || []) as any[];
    const started = new Date(body.startedAt || new Date().toISOString()).getTime();
    const timeMs = Math.max(0, Date.now() - started);
    const perQ = answers.length ? Math.round(timeMs / answers.length) : 0;
    let correct = 0;
    const byType: Record<string, { total: number; ok: number }> = {};
    for (const a of answers) {
      const q = await env.DB.prepare("SELECT answer, question_type, skill FROM questions WHERE id=?").bind(a.questionId || "").first() as any;
      if (!q) continue;
      // Objective scoring only: compare against the authoritative key, never ask AI.
      const hit = String(a.answer || "").trim().toLowerCase() === String(q.answer || "").trim().toLowerCase() ? 1 : 0;
      correct += hit;
      const t = byType[q.question_type] || (byType[q.question_type] = { total: 0, ok: 0 });
      t.total++; t.ok += hit;
      await env.DB.prepare(
        "INSERT INTO question_attempts(id,user_id,skill,question_type,correct,time_spent,error_type,question_id,quest_id,user_answer,correct_answer,time_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(id(), userId, q.skill, q.question_type, hit, Math.round(perQ / 1000), hit ? null : "wrong-answer", a.questionId, quest.id, String(a.answer || "").slice(0, 500), String(q.answer || "").slice(0, 500), perQ).run().catch(() => {});
      const prev = await env.DB.prepare(
        "SELECT attempts, correct FROM error_patterns WHERE user_id=? AND skill=? AND pattern=?"
      ).bind(userId, q.skill, q.question_type).first().catch(() => null) as any;
      await env.DB.prepare(
        `INSERT INTO error_patterns(user_id,skill,pattern,attempts,correct,priority,updated_at)
         VALUES(?,?,?,?,?,'MEDIUM',CURRENT_TIMESTAMP)
         ON CONFLICT(user_id,skill,pattern) DO UPDATE SET attempts=excluded.attempts, correct=excluded.correct, updated_at=CURRENT_TIMESTAMP`
      ).bind(userId, q.skill, q.question_type, Number(prev?.attempts || 0) + 1, Number(prev?.correct || 0) + hit).run().catch(() => {});
    }
    const total = answers.length;
    const accuracy = total ? correct / total : 0;
    const hints = Math.max(0, Number(body.hintsUsed || 0));
    const base = Math.min(200, 5 * Math.max(1, total));
    const mult = accuracy >= 0.95 ? 1.6 : accuracy >= 0.85 ? 1.3 : accuracy >= 0.7 ? 1.0 : accuracy >= 0.4 ? 0.4 : 0.1;
    let xp = Math.max(0, Math.round(base * mult) - 5 * hints);
    let combo = accuracy >= 0.95 && total >= 5 ? "MASTER RUN" : accuracy >= 0.85 && total >= 5 ? "COMBO x2" : null;
    if (accuracy >= 0.95) xp = Math.round(xp * 1.3);
    else if (accuracy >= 0.85) xp = Math.round(xp * 1.2);
    const coins = Math.round(xp / 4);
    await addXP(env, userId, xp, coins);
    await env.DB.prepare(
      "INSERT INTO quest_attempts(id,quest_id,user_id,score,accuracy,time_ms,hints_used,xp_earned) VALUES(?,?,?,?,?,?,?,?)"
    ).bind(id(), quest.id, userId, correct, accuracy, timeMs, hints, xp).run().catch(() => {});
    await env.DB.prepare("UPDATE quests SET status='done', xp_reward=? WHERE id=?").bind(xp, quest.id).run().catch(() => {});
    // Spec section 28 progression: >=70% unlocks next, never block the campaign.
    let unlocked: any = null;
    if (accuracy >= 0.7) {
      const next = await env.DB.prepare(
        "SELECT * FROM quests WHERE user_id=? AND day>? ORDER BY day ASC LIMIT 1"
      ).bind(userId, Number(quest.day || 0)).first().catch(() => null) as any;
      if (next) {
        await env.DB.prepare("UPDATE quests SET status='unlocked' WHERE id=?").bind(next.id).run().catch(() => {});
        unlocked = { id: next.id, day: next.day, title: next.title };
      }
      const prof = await ensureProfile(env, userId) as any;
      const lastDay = String(prof.last_active || "").slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      if (lastDay !== today) {
        await env.DB.prepare("UPDATE profiles SET streak_days=streak_days+1 WHERE user_id=?").bind(userId).run().catch(() => {});
        const s = await ensureProfile(env, userId) as any;
        if (Number(s.streak_days) === 7) await unlock(env, userId, "streak-7", "7-day streak");
      }
    }
    await unlock(env, userId, "first-quest", "First quest complete");
    if (accuracy >= 0.95) await unlock(env, userId, "mastery", "Mastery run 95%+");
    if (/boss|final|mini/.test(quest.quest_type || "") && accuracy >= 0.7) {
      await unlock(env, userId, "boss-slayer", "Boss defeated");
      await env.DB.prepare(
        "INSERT INTO boss_battles(id,user_id,day,kind,focus_json,score_before,score_after) VALUES(?,?,?,?,?,?,?)"
      ).bind(id(), userId, Number(quest.day || 0), quest.quest_type, JSON.stringify(byType), 0, accuracy).run().catch(() => {});
    }
    const strong = Object.entries(byType).filter(([, v]) => v.total > 0 && v.ok / v.total >= 0.8).map(([k]) => k);
    const weak = Object.entries(byType).filter(([, v]) => v.total > 0 && v.ok / v.total < 0.7).map(([k]) => k);
    const next = await buildNextActions(env, userId);
    return cors(json({
      score: correct, total, accuracy: Number(accuracy.toFixed(3)), timeMs,
      strong, weak, xp, coins, combo, unlocked,
      nextBest: next.actions, estimatedMinutes: next.estimatedMinutes,
      practiceEstimate: true
    }));
  }

  if (path === "/api/next-actions" && req.method === "GET") {
    const userId = url.searchParams.get("userId") || "demo-user";
    const rows = await env.DB.prepare("SELECT rank, action, reason FROM next_actions WHERE user_id=? ORDER BY rank").bind(userId).all().catch(() => ({ results: [] }));
    return cors(json((rows as any).results || []));
  }

  // ---------- Spec section 13-20: Paraphrase Forge ----------
  if (path === "/api/forge/item" && req.method === "GET") {
    const userId = url.searchParams.get("userId") || "demo-user";
    const difficulty = Math.min(6, Math.max(1, Number(url.searchParams.get("difficulty") || 1)));
    const count = Math.min(5, Math.max(1, Number(url.searchParams.get("count") || 1)));
    const clean = (s: string) => String(s || "").trim().replace(/\s+/g, " ").replace(/[.。!?…]+$/, "");
    const existing = await env.DB.prepare(
      "SELECT * FROM paraphrase_items WHERE user_id=? AND difficulty=? ORDER BY created_at ASC LIMIT 1"
    ).bind(userId, difficulty).first().catch(() => null) as any;
    if (existing && count === 1) {
      return cors(json({ id: existing.id, source_text: existing.source_text, target_text: existing.target_text, difficulty: existing.difficulty, vocab: JSON.parse(existing.source_vocab_json || "[]") }));
    }
    const levelHint = ["direct vocabulary", "synonym substitution", "grammatical transformation", "mixed transformation", "IELTS Reading paraphrase recognition", "IELTS Writing sentence production"][difficulty - 1];
    // One AI call for the whole batch (was one call per sentence).
    const data = await aiJSON(env, `You are an IELTS paraphrase item writer.
Return ONLY JSON: {"items":[{"source_text":"","target_text":"","vocab":["",""]}]}
Write exactly ${count} items.
source_text: a natural Vietnamese sentence (12-20 words). Never end with a period.
target_text: its English equivalent at difficulty "${levelHint}" (12-22 words, single sentence). Never end with a period.
vocab: 3-5 key English words from target_text worth reviewing.
Write original sentences, nothing copyrighted.`);
    const rawItems = (Array.isArray((data as any).items) ? (data as any).items : [data]).slice(0, count);
    const items: any[] = [];
    for (const it of rawItems) {
      const itemId = id();
      const source = clean(it.source_text);
      const target = clean(it.target_text);
      if (!source || !target) continue;
      await env.DB.prepare(
        "INSERT INTO paraphrase_items(id,user_id,source_text,target_text,difficulty,source_vocab_json) VALUES(?,?,?,?,?,?)"
      ).bind(itemId, userId, source, target, difficulty, JSON.stringify(it.vocab || [])).run();
      items.push({ id: itemId, source_text: source, target_text: target, difficulty, vocab: it.vocab || [] });
    }
    if (!items.length) return cors(json({ error: "AI returned no usable items" }, 502));
    return cors(json(count === 1 ? items[0] : { items, difficulty }));
  }

  if (path === "/api/forge/complete" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    const accuracy = Math.min(1, Math.max(0, Number(body.accuracy ?? 0)));
    const hints = Math.max(0, Number(body.hintsUsed || 0));
    const xp = Math.max(5, Math.round(30 + 70 * accuracy) - 5 * hints);
    const coins = Math.round(xp / 4);
    const combo = accuracy >= 1 ? "SENTENCE FORGED" : accuracy >= 0.9 ? "COMBO x2" : null;
    await addXP(env, userId, xp, coins);
    // Spec section 20: extracted vocabulary joins the review queue.
    const item = await env.DB.prepare("SELECT source_vocab_json FROM paraphrase_items WHERE id=?").bind(body.itemId || "").first().catch(() => null) as any;
    const words: string[] = (JSON.parse(item?.source_vocab_json || "[]") as string[]).slice(0, 8);
    const setId = await ensureForgeSet(env, userId);
    let added = 0;
    for (const w of words) {
      const word = String(w || "").trim().toLowerCase();
      if (!word) continue;
      const vid = id();
      await env.DB.prepare("INSERT INTO vocabulary(id,set_id,word) VALUES(?,?,?)").bind(vid, setId, word).run().catch(() => {});
      await env.DB.prepare(
        "INSERT INTO vocabulary_reviews(id,user_id,vocabulary_id,correct,time_ms,review_level,next_review_at) VALUES(?,?,?,?,?,?,?)"
      ).bind(id(), userId, vid, 1, Number(body.timeMs || 0), 0, reviewDate(new Date(), 0)).run().catch(() => {});
      added++;
    }
    await unlock(env, userId, "forge-first", "First sentence forged");
    return cors(json({ ok: true, xp, coins, combo, vocabAdded: added }));
  }

  if (path === "/api/forge/flex" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    const item = await env.DB.prepare("SELECT source_text, target_text FROM paraphrase_items WHERE id=?").bind(body.itemId || "").first().catch(() => null) as any;
    if (!item) return cors(json({ error: "item not found" }, 404));
    // Spec section 19: never mark a valid alternative wrong for differing from reference.
    const data = await aiJSON(env, `You are an IELTS paraphrase judge.
Return ONLY JSON: {"equivalent":true,"score":0.0,"feedback":""}
Reference: "${item.target_text}"
Candidate: "${String(body.candidate || "").slice(0, 1000)}"
Judge semantic equivalence, grammar, naturalness and lexical quality. A valid alternative that differs from the reference is still correct.`);
    const score = Math.min(1, Math.max(0, Number(data.score ?? 0)));
    const xp = Math.round(score * 80);
    await addXP(env, userId, xp, Math.round(xp / 4));
    return cors(json({ equivalent: !!data.equivalent, score, feedback: data.feedback || "", xp }));
  }

  // ---------- Spec section 21: spaced repetition Day 0/1/3/6/10/15/20 ----------
  if (path === "/api/review/submit" && req.method === "POST") {
    const body = await req.json() as any;
    const userId = body.userId || "demo-user";
    const correct = body.correct ? 1 : 0;
    const last = await env.DB.prepare(
      "SELECT review_level FROM vocabulary_reviews WHERE user_id=? AND vocabulary_id=? ORDER BY created_at DESC LIMIT 1"
    ).bind(userId, body.vocabularyId || "").first().catch(() => null) as any;
    const level = last
      ? (correct ? Math.min(REVIEW_LADDER.length - 1, Number(last.review_level) + 1) : Math.max(0, Number(last.review_level) - 1))
      : (correct ? 1 : 0);
    const nextAt = reviewDate(new Date(), REVIEW_LADDER[level]);
    await env.DB.prepare(
      "INSERT INTO vocabulary_reviews(id,user_id,vocabulary_id,correct,time_ms,review_level,next_review_at) VALUES(?,?,?,?,?,?,?)"
    ).bind(id(), userId, body.vocabularyId || "", correct, Number(body.timeMs || 0), level, nextAt).run();
    if (correct) await addXP(env, userId, 3, 1);
    if (level === REVIEW_LADDER.length - 1) await unlock(env, userId, "word-mastered", "Word mastered");
    return cors(json({ ok: true, level, nextReviewAt: nextAt }));
  }

  if (path === "/api/review/due" && req.method === "GET") {
    const userId = url.searchParams.get("userId") || "demo-user";
    const rows = await env.DB.prepare(
      `SELECT v.id, v.word, v.meaning_vi, r.review_level, r.next_review_at FROM vocabulary v
       JOIN (SELECT vocabulary_id, MAX(created_at) mc FROM vocabulary_reviews WHERE user_id=? GROUP BY vocabulary_id) l ON l.vocabulary_id=v.id
       JOIN vocabulary_reviews r ON r.vocabulary_id=l.vocabulary_id AND r.created_at=l.mc
       WHERE r.next_review_at <= date('now') ORDER BY r.next_review_at LIMIT 50`
    ).bind(userId).all().catch(() => ({ results: [] }));
    return cors(json((rows as any).results || []));
  }

  return cors(json({ error: "Not found" }, 404));
}

export default {
  async fetch(req: Request, env: Env) {
    try { return await handle(req, env); }
    catch (e: any) { return cors(json({ error: e?.message || "Server error" }, 500)); }
  }
};
