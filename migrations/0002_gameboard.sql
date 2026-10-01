CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  current_reading REAL DEFAULT 6.5,
  current_listening REAL DEFAULT 6.5,
  current_writing REAL DEFAULT 6.0,
  current_speaking REAL DEFAULT 6.5,
  target_overall_min REAL DEFAULT 8.0,
  target_reading_min REAL DEFAULT 8.5,
  target_listening_min REAL DEFAULT 8.5,
  target_writing_min REAL DEFAULT 7.5,
  target_speaking_min REAL DEFAULT 7.5,
  stretch_reading REAL DEFAULT 9.0,
  stretch_listening REAL DEFAULT 9.0,
  stretch_writing REAL DEFAULT 8.0,
  stretch_speaking REAL DEFAULT 8.0,
  xp INTEGER DEFAULT 0,
  coins INTEGER DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  last_active TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  question_type TEXT NOT NULL,
  correct INTEGER NOT NULL,
  time_spent INTEGER DEFAULT 0,
  error_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_skill ON question_attempts(user_id, skill, question_type);

CREATE TABLE IF NOT EXISTS error_patterns (
  user_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  pattern TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  correct INTEGER DEFAULT 0,
  priority TEXT DEFAULT 'MEDIUM',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, skill, pattern)
);

CREATE TABLE IF NOT EXISTS ai_memory (
  user_id TEXT NOT NULL,
  memory_type TEXT DEFAULT 'weakness',
  skill TEXT NOT NULL,
  pattern TEXT NOT NULL,
  confidence REAL DEFAULT 0,
  evidence_count INTEGER DEFAULT 0,
  priority TEXT DEFAULT 'MEDIUM',
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, skill, pattern)
);

CREATE TABLE IF NOT EXISTS quests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  day INTEGER DEFAULT 0,
  kingdom TEXT NOT NULL,
  title TEXT NOT NULL,
  quest_type TEXT DEFAULT 'practice',
  impact TEXT DEFAULT 'MEDIUM',
  status TEXT DEFAULT 'open',
  xp_reward INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quests_user_day ON quests(user_id, day);

CREATE TABLE IF NOT EXISTS boss_battles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  day INTEGER DEFAULT 0,
  kind TEXT NOT NULL,
  focus_json TEXT,
  score_before REAL,
  score_after REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, code)
);

CREATE TABLE IF NOT EXISTS flashcard_reviews (
  id TEXT PRIMARY KEY,
  vocab_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  next_review_day INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reviews_vocab ON flashcard_reviews(vocab_id);
