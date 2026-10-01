// Retest harness: real in-memory SQLite (node:sqlite) + mocked Workers AI.
// Exercises every Worker endpoint incl. game-board / 80-20 APIs.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import worker from '../src/index.ts';

const db = new DatabaseSync(':memory:');
for (const f of ['migrations/0001_init.sql', 'migrations/0002_gameboard.sql']) {
  db.exec(fs.readFileSync(f, 'utf8'));
}

// D1-compatible shim over node:sqlite
const D1 = {
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
      return { response: JSON.stringify({ words: [{ word: 'mitigate', pos: 'verb', definition: 'to reduce severity', meaning_vi: 'giam nhe', example: 'Policies mitigate risks.', collocations: ['mitigate risk'], synonyms: ['alleviate'], difficulty: 3 }] }) };
    }
    if (prompt.includes('multiple-choice questions')) {
      return { response: JSON.stringify({ questions: [{ question: 'mitigate means?', options: ['reduce', 'grow', 'hide', 'skip'], answer: 'reduce', explanation: 'it means reduce' }] }) };
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

console.log(`\nRESULT ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
