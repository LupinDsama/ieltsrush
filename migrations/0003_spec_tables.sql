-- Spec section 25: source registry with attribution.
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  title TEXT,
  source_name TEXT,
  url TEXT UNIQUE,
  source_type TEXT DEFAULT 'official',
  test_type TEXT,
  section TEXT,
  license_note TEXT,
  date_added TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Spec section 25: question bank with authoritative answer keys.
-- NOTE: answer must never be sent to the client before submission.
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  skill TEXT NOT NULL,
  section TEXT,
  question_type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options_json TEXT,
  answer TEXT NOT NULL,
  explanation TEXT,
  difficulty INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_id) REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS idx_questions_skill_type ON questions(skill, question_type);

-- Spec section 26: extend attempts with objective answer data.
ALTER TABLE question_attempts ADD COLUMN question_id TEXT;
ALTER TABLE question_attempts ADD COLUMN quest_id TEXT;
ALTER TABLE question_attempts ADD COLUMN user_answer TEXT;
ALTER TABLE question_attempts ADD COLUMN correct_answer TEXT;
ALTER TABLE question_attempts ADD COLUMN time_ms INTEGER DEFAULT 0;

-- Spec section 26: extend quests with spec fields.
ALTER TABLE quests ADD COLUMN skill TEXT;
ALTER TABLE quests ADD COLUMN difficulty INTEGER DEFAULT 1;
ALTER TABLE quests ADD COLUMN priority REAL DEFAULT 0.5;

-- Spec section 26: per-quest attempt results (progression + XP).
CREATE TABLE IF NOT EXISTS quest_attempts (
  id TEXT PRIMARY KEY,
  quest_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score REAL DEFAULT 0,
  accuracy REAL DEFAULT 0,
  time_ms INTEGER DEFAULT 0,
  hints_used INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quest_attempts_quest ON quest_attempts(quest_id);

-- Spec section 21 + 26: vocabulary review queue with Day 0/1/3/6/10/15/20 checkpoints.
CREATE TABLE IF NOT EXISTS vocabulary_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  vocabulary_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  time_ms INTEGER DEFAULT 0,
  review_level INTEGER DEFAULT 0,
  next_review_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vocab_reviews_vocab ON vocabulary_reviews(vocabulary_id);

-- Spec section 26: Paraphrase Forge items (VI prompt, hidden EN target).
CREATE TABLE IF NOT EXISTS paraphrase_items (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  difficulty INTEGER DEFAULT 1,
  source_vocab_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Spec section 31 HUD + section 23 direction: persisted next-best actions.
CREATE TABLE IF NOT EXISTS next_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  rank INTEGER DEFAULT 0,
  action TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
