CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS study_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  date TEXT,
  target TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, day)
);

CREATE TABLE IF NOT EXISTS vocab_sets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  topic TEXT NOT NULL,
  level TEXT DEFAULT 'B2-C1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vocabulary (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL,
  word TEXT NOT NULL,
  pos TEXT,
  definition TEXT,
  meaning_vi TEXT,
  example TEXT,
  collocations TEXT,
  synonyms TEXT,
  difficulty INTEGER DEFAULT 3,
  source_url TEXT,
  FOREIGN KEY(set_id) REFERENCES vocab_sets(id)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  answer TEXT NOT NULL,
  explanation TEXT,
  FOREIGN KEY(set_id) REFERENCES vocab_sets(id)
);

CREATE TABLE IF NOT EXISTS paraphrases (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  original_text TEXT NOT NULL,
  paraphrase TEXT NOT NULL,
  technique TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS writing_prompts (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  prompt TEXT NOT NULL,
  source_name TEXT,
  source_url TEXT,
  source_type TEXT DEFAULT 'official',
  year TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS writing_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  prompt_id TEXT,
  task TEXT,
  answer TEXT NOT NULL,
  estimated_band REAL,
  feedback_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS speaking_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  part INTEGER,
  topic TEXT,
  transcript TEXT,
  feedback_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY,
  title TEXT,
  url TEXT UNIQUE,
  source_name TEXT,
  source_type TEXT,
  license_note TEXT,
  content_excerpt TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vocab_set ON vocabulary(set_id);
CREATE INDEX IF NOT EXISTS idx_quiz_set ON quiz_questions(set_id);
CREATE INDEX IF NOT EXISTS idx_writing_task ON writing_prompts(task);
