// Retest harness: real in-memory SQLite (node:sqlite) + mocked Workers AI.
// Exercises every Worker endpoint incl. game-board / 80-20 APIs.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import worker, { parseModelJSON } from '../src/index.ts';

const db = new DatabaseSync(':memory:');
for (const f of ['migrations/0001_init.sql', 'migrations/0002_gameboard.sql', 'migrations/0003_spec_tables.sql']) {
  db.exec(fs.readFileSync(f, 'utf8'));
}

// D1-compatible shim over node:sqlite
const D1 = {
  async batch(stmts) {
    for (const s of stmts) await s.run();
    return [];
  },
  prepare(sql) {
    const stmt = db.prepare(sql);
    const bound = {
      _params: [],
      bind(...p) { this._params = p; return this; },
      all() {
        const rows = stmt.all(...this._params);
        return Promise.resolve({ results: rows });
      },
      first() {
        const row = stmt.get(...this._params);
        return Promise.resolve(row ?? null);
      },
      run() {
        stmt.run(...this._params);
        return Promise.resolve({});
      },
    };
    return bound;
  },
};

const AI = {
  async run(model, { prompt }) {
    if (prompt.includes('vocabulary teacher')) {
      return { response: JSON.stringify({ words: [{ word: 'mitigate', pos: 'verb', definition: 'to reduce severity', meaning_vi: 'giam nhe', example: 'Policies mitigate risks.', collocations: ['mitigate risk'], synonyms: ['alleviate'], difficulty: 3 }], questions: [{ question: 'mitigate means?', options: ['reduce', 'grow', 'hide', 'skip'], answer: 'reduce', explanation: 'it means reduce' }] }) };
    }
    if (prompt.includes('paraphrase item writer')) {
      const n = (prompt.match(/Write exactly (\d+) items/) || [])[1] || 1;
      const items = Array.from({ length: Number(n) }, (_, i) => ({ source_text: `Cau tieng Viet so ${i + 1}.`, target_text: `English sentence number ${i + 1}.`, vocab: ['english', 'sentence'] }));
      return { response: JSON.stringify({ items }) };
    }
    if (prompt.includes('paraphrasing coach')) {
      return { response: JSON.stringify({ versions: [{ text: 'v1', techniques: ['syn'], notes: 'n' }], key_changes: [{ original: 'a', replacement: 'b', reason: 'c' }] }) };
    }
    if (prompt.includes('writing assessor')) {
      return { response: JSON.stringify({ estimated_band: 6.5, criteria: { task: 't', coherence: 'c', lexical: 'l', grammar: 'g' }, errors: [], action_plan: ['fix thesis'], improved_excerpt: 'better' }) };
    }
    if (prompt.includes('Speaking coach')) {
      return { response: JSON.stringify({ estimated_band: 6.5, fluency_coherence: 'f', lexical_resource: 'l', grammar: 'g', pronunciation_note: 'n/a', better_phrases: ['p'], follow_up_questions: ['q'] }) };
    }
    return { response: '{}' };
  },
};

const env = { DB: D1, AI, APP_NAME: 'test' };
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra); }
};
const call = async (path, { method = 'GET', body = null } = {}) => {
  const req = new Request('http://x' + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null,
  });
  const res = await worker.fetch(req, env);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cors: res.headers.get('access-control-allow-origin') };
};

// 1 health + CORS
let r = await call('/api/health');
ok('health', r.status === 200 && r.data.ok === true && r.cors === '*', JSON.stringify(r.data));

// 2 seed campaign
r = await call('/api/plan/seed', { method: 'POST', body: {} });
ok('seed', r.data.ok === true, JSON.stringify(r.data));

// 3 dashboard bundles profile + priorities
r = await call('/api/dashboard');
ok('dashboard days=20', r.data.days?.length === 20, 'got ' + r.data.days?.length);
ok('dashboard profile', !!r.data.profile && r.data.profile.level === 1, JSON.stringify(r.data.profile));
ok('dashboard priorities', !!r.data.priorities && r.data.priorities.overallMin === 8.0, 'no priorities');

// 4 profile update
r = await call('/api/profile', { method: 'POST', body: { reading: 7, listening: 7.5, writing: 6, speaking: 6.5 } });
ok('profile save', r.data.current_writing === 6, JSON.stringify(r.data));

// 5 attempts: writing thesis wrong x4, TFNG wrong x2 + correct x1
for (let i = 0; i < 4; i++) await call('/api/attempts/log', { method: 'POST', body: { skill: 'writing', questionType: 'thesis', correct: false } });
await call('/api/attempts/log', { method: 'POST', body: { skill: 'reading', questionType: 'TFNG', correct: false } });
await call('/api/attempts/log', { method: 'POST', body: { skill: 'reading', questionType: 'TFNG', correct: false } });
await call('/api/attempts/log', { method: 'POST', body: { skill: 'reading', questionType: 'TFNG', correct: true } });
r = await call('/api/memory/priority');
const weak = r.data.weaknesses || [];
ok('priority ranks writing-thesis first', weak[0]?.skill === 'writing' && weak[0]?.pattern === 'thesis', JSON.stringify(weak.map(w => w.skill + '/' + w.pattern + '=' + w.score.toFixed(2))));
ok('priority timeSplit 96/24', r.data.timeSplit?.highImpactMin === 96 && r.data.timeSplit?.maintenanceMin === 24);

// 6 quests: quality earns more than spam
const q1 = await call('/api/quests/complete', { method: 'POST', body: { total: 20, correct: 18, explained: 15, fixedOldErrors: 3, streak: 5, kingdom: 'writing', title: 't' } });
const q2 = await call('/api/quests/complete', { method: 'POST', body: { total: 20, correct: 5, explained: 0, fixedOldErrors: 0, streak: 0, kingdom: 'reading', title: 's' } });
ok('quest quality > spam', q1.data.xp > q2.data.xp, `${q1.data.xp} vs ${q2.data.xp}`);
ok('quest combo', q1.data.combo === 'COMBO x3', q1.data.combo);
r = await call('/api/dashboard');
ok('xp accumulated + level up', r.data.profile.xp === q1.data.xp + q2.data.xp, 'xp=' + r.data.profile.xp);

// 7 boss uses weakest patterns
r = await call('/api/boss/generate', { method: 'POST', body: { day: 10 } });
ok('boss focus', (r.data.focus || []).length > 0 && r.data.questions === 40, JSON.stringify(r.data).slice(0, 200));

// 8 vocab generate + fetch set
r = await call('/api/vocab/generate', { method: 'POST', body: { topic: 'Environment', count: 1 } });
ok('vocab generate', !!r.data.setId && r.data.words?.length === 1 && r.data.questions?.length === 1, JSON.stringify(r.data).slice(0, 200));
const setId = r.data.setId;
r = await call('/api/vocab/set?id=' + setId);
ok('vocab set fetch', r.data.words?.length === 1 && r.data.questions?.length === 1, JSON.stringify(r.data).slice(0, 200));
r = await call('/api/vocab/set');
ok('vocab set missing id 400', r.status === 400);

// 9 flashcard review ladder
const vocabId = db.prepare('SELECT id FROM vocabulary LIMIT 1').get().id;
r = await call('/api/flashcard/review', { method: 'POST', body: { vocabId, correct: true } });
ok('flashcard next=2', r.data.nextReviewDay === 2, JSON.stringify(r.data));
r = await call('/api/flashcard/review', { method: 'POST', body: { vocabId, correct: false } });
ok('flashcard reset=1', r.data.nextReviewDay === 1, JSON.stringify(r.data));

// 10 paraphrase / writing / speaking / sources / prompts
r = await call('/api/paraphrase', { method: 'POST', body: { text: 'Education is important.' } });
ok('paraphrase', (r.data.versions || []).length === 1);
r = await call('/api/writing/feedback', { method: 'POST', body: { task: 'task2', prompt: 'Q', answer: 'My essay' } });
ok('writing band', r.data.estimated_band === 6.5 && !!r.data.id);
r = await call('/api/speaking/feedback', { method: 'POST', body: { part: 2, transcript: 'I like...' } });
ok('speaking band', r.data.estimated_band === 6.5);
r = await call('/api/sources', { method: 'POST', body: { title: 't', url: 'https://x.test/1', excerpt: 'e' } });
ok('sources', r.data.ok === true);
r = await call('/api/writing/prompts');
ok('prompts array', Array.isArray(r.data));

// 11 toggle day
r = await call('/api/plan/toggle', { method: 'POST', body: { day: 1, completed: true } });
ok('toggle', r.data.ok === true);
r = await call('/api/dashboard');
ok('day1 done', r.data.days[0].completed === 1);

// 12 misc
r = await call('/api/nope');
ok('404', r.status === 404);
r = await call('/api/health', { method: 'POST', body: null }).catch(() => ({ status: 0 }));
ok('options cors', (await worker.fetch(new Request('http://x/api/health', { method: 'OPTIONS' }), env)).status === 204);

// 13 parseModelJSON repairs fenced / truncated model output
try {
  const a = parseModelJSON('```json\n{"versions":[{"text":"hi"}]}\n```');
  ok('parse fenced', a.versions?.length === 1, JSON.stringify(a).slice(0, 80));
} catch (e) { ok('parse fenced', false, String(e)); }
try {
  const b = parseModelJSON('{"versions":[{"text":"a"}],"key_changes":');
  ok('parse truncated', b.versions?.length === 1, JSON.stringify(b).slice(0, 80));
} catch (e) { ok('parse truncated', false, String(e)); }
try {
  const c = parseModelJSON('Sure! Here is it:\n{"words":[{"word":"mitigate"}]}\nHope that helps');
  ok('parse prose-wrapped', c.words?.[0]?.word === 'mitigate', JSON.stringify(c).slice(0, 80));
} catch (e) { ok('parse prose-wrapped', false, String(e)); }

// 14 key ring: rotates to next key on retryable failure, falls back when all fail
{
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    if (String(url).includes('generativelanguage')) {
      const k = opt.headers['x-goog-api-key'];
      seen.push(k);
      if (k === 'k1') return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"versions":[{"text":"ok"}],"key_changes":[]}' }] } }] }), { status: 200 });
    }
    return realFetch(url, opt);
  };
  const env2 = { ...env, AI_API_KEY: 'k1', AI_API_KEY_2: 'k2' };
  const req = new Request('http://x/api/paraphrase', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hi.' }) });
  const res = await worker.fetch(req, env2);
  const data = await res.json();
  ok('key rotation tries next key', seen.join(',') === 'k1,k2' && (data.versions || []).length === 1, seen.join(','));
  globalThis.fetch = async (url, opt) => {
    if (String(url).includes('generativelanguage')) {
      return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 });
    }
    return realFetch(url, opt);
  };
  const req2 = new Request('http://x/api/dashboard', { method: 'GET' });
  const res2 = await worker.fetch(req2, env);
  ok('dashboard unaffected by fetch stub', res2.status === 200);
  globalThis.fetch = realFetch;
}

// 15 spec: sources seed + question bank hides answers pre-submit
r = await call('/api/sources/seed', { method: 'POST', body: {} });
ok('sources seed', r.data.ok === true && r.data.seeded === 3, JSON.stringify(r.data));
r = await call('/api/sources');
ok('sources list', Array.isArray(r.data) && r.data.length === 3 && !!r.data[0].license_note);
const srcId = r.data[0].id;
r = await call('/api/questions', { method: 'POST', body: { skill: 'reading', questionType: 'TFNG', prompt: 'The sky is green. TRUE/FALSE/NOT GIVEN?', options: ['TRUE', 'FALSE', 'NOT GIVEN'], answer: 'FALSE', explanation: 'Sky is blue.', sourceId: srcId } });
ok('question add', !!r.data.id);
const qid1 = r.data.id;
r = await call('/api/questions', { method: 'POST', body: { skill: 'reading', prompt: 'no key' } });
ok('question requires key', r.status === 400);
r = await call('/api/questions?skill=reading&type=TFNG&limit=5');
ok('questions hide answer', r.data.length === 1 && !('answer' in r.data[0]) && r.data[0].prompt.includes('sky'));

// 16 spec: diagnostic -> profile + v2 priorities with components
r = await call('/api/diagnostic/submit', { method: 'POST', body: { bands: { reading: 7, listening: 7, writing: 6, speaking: 6 }, results: [{ skill: 'reading', questionType: 'TFNG', correct: 5, total: 10 }] } });
ok('diagnostic profile', r.data.profile?.current_reading === 7, JSON.stringify(r.data.profile)?.slice(0, 120));
ok('diagnostic v2 components', Array.isArray(r.data.priorities?.components) && r.data.priorities.components[0]?.impact === 0.9, JSON.stringify(r.data.priorities?.components?.[0]));
ok('diagnostic next best', (r.data.nextBest?.actions || []).length > 0);

// 17 spec: quest generate from evidence + timed start + objective submit
r = await call('/api/quests/generate', { method: 'POST', body: { day: 6 } });
ok('quest generate evidence', !!r.data.quest?.id && r.data.quest.skill === 'reading' && r.data.needsContent === false && (r.data.questions || []).length === 1, JSON.stringify(r.data.quest));
const genQuest = r.data.quest.id;
r = await call('/api/quest/start', { method: 'POST', body: { questId: genQuest } });
ok('quest start timed', !!r.data.startedAt && r.data.durationMin === 15 && JSON.stringify(r.data.warnings) === '[50,75,90,100]' && !('answer' in (r.data.questions[0] || {})), JSON.stringify(r.data).slice(0, 160));
r = await call('/api/quest/submit', { method: 'POST', body: { questId: genQuest, answers: [{ questionId: qid1, answer: 'FALSE' }], startedAt: new Date(Date.now() - 60000).toISOString(), hintsUsed: 0 } });
ok('quest submit objective', r.data.accuracy === 1 && r.data.score === 1 && r.data.xp > 0 && (r.data.nextBest || []).length > 0 && r.data.practiceEstimate === true, JSON.stringify(r.data).slice(0, 200));
r = await call('/api/quest/submit', { method: 'POST', body: { questId: 'nope', answers: [] } });
ok('quest submit 404', r.status === 404);
r = await call('/api/next-actions');
ok('next actions stored', Array.isArray(r.data) && r.data.length > 0);

// 18 spec: forge item + strict complete + review queue (flex needs live AI, skip)
{
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    if (String(url).includes('generativelanguage')) {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"source_text":"Chinh phu nen dau tu vao giao duc.","target_text":"The government should invest in education.","vocab":["government","invest","education"]}' }] } }] }), { status: 200 });
    }
    return realFetch2(url, opt);
  };
  const env3 = { ...env, AI_API_KEY: 'k9' };
  const ri = await worker.fetch(new Request('http://x/api/forge/item?difficulty=1', { method: 'GET' }), env3);
  const item = await ri.json();
  ok('forge item', !!item.id && !!item.source_text && !!item.target_text, JSON.stringify(item).slice(0, 120));
  const rc = await worker.fetch(new Request('http://x/api/forge/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: item.id, accuracy: 1, timeMs: 21000, mistakes: 0, hintsUsed: 0 }) }), env3);
  const done = await rc.json();
  ok('forge complete vocab queue', done.ok === true && done.combo === 'SENTENCE FORGED' && done.vocabAdded === 3, JSON.stringify(done));
  globalThis.fetch = realFetch2;
}
r = await call('/api/review/due');
ok('review due lists forge words', Array.isArray(r.data) && r.data.length === 3, 'got ' + r.data.length);
const vid = r.data[0].id;
r = await call('/api/review/submit', { method: 'POST', body: { vocabularyId: vid, correct: true, timeMs: 1500 } });
ok('review ladder up', r.data.ok === true && r.data.level === 1, JSON.stringify(r.data));

// 19 forge batch: one call, N sentences, no trailing periods
r = await call('/api/forge/item?difficulty=2&count=3');
ok('forge batch count', (r.data.items || []).length === 3, JSON.stringify(r.data).slice(0, 160));
ok('forge no trailing period', (r.data.items || []).every(i => !/[.。!?…]$/.test(i.target_text) && !/[.。!?…]$/.test(i.source_text)), JSON.stringify((r.data.items || []).map(i => i.target_text)));
r = await call('/api/forge/item?difficulty=2&count=1');
ok('forge single compat', !!r.data.id && !!r.data.target_text);

// 20 vocab generate: single AI call + batch insert
r = await call('/api/vocab/generate', { method: 'POST', body: { topic: 'Health', count: 1 } });
ok('vocab combined', !!r.data.setId && r.data.words?.length === 1 && r.data.questions?.length === 1, JSON.stringify(r.data).slice(0, 160));
r = await call('/api/vocab/generate', { method: 'POST', body: { topic: 'Health', count: 50 } });
ok('vocab chunked parallel', r.data.words?.length === 4 && r.data.questions?.length === 4, 'words=' + r.data.words?.length);

console.log(`\nRESULT ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
