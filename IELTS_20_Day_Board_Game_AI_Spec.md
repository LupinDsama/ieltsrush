# IELTS 20-Day Board Game — AI Build Specification

## 1. Product goal

Build a 20-day IELTS Academic learning game for a learner starting around 6.5.

Targets:
- Minimum campaign target: Overall 8.0
- Stretch skill targets: Reading 9.0, Listening 9.0, Writing 8.0, Speaking 8.0

Important: 9/9/8/8 averages to 8.5, so the UI must show Overall 8.0 as the minimum campaign target and 9/9/8/8 as stretch skill targets.

The product is an adaptive IELTS training system, not merely an AI chatbot with a game skin.

Core loop:

```text
Diagnostic
  -> Error analysis
  -> 80/20 priority calculation
  -> Board quests
  -> Timed attempt
  -> Score + error taxonomy
  -> D1 memory
  -> AI direction
  -> Next quest
```

## 2. Official IELTS structure

Use official IELTS material as the primary source whenever possible.

Official IELTS Academic practice material covers:
- Reading: 60 minutes, 40 questions
- Listening: approximately 30 minutes, 40 questions
- Writing: 60 minutes, Task 1 + Task 2
- Speaking: 11–14 minutes, Parts 1–3

Official Academic samples include Reading types such as:
- Multiple choice
- True / False / Not Given
- Yes / No / Not Given
- Matching information
- Matching headings
- Matching features
- Matching sentence endings
- Summary completion
- Note completion
- Table completion
- Flow-chart completion
- Diagram labelling
- Short-answer questions

Listening samples include:
- Multiple choice
- Matching
- Plan/map/diagram labelling
- Form completion
- Note completion
- Table completion
- Flow-chart completion
- Summary completion
- Sentence completion
- Short-answer questions

Primary source:
https://ielts.org/take-a-test/preparation-resources/sample-test-questions/academic-test

Every externally sourced question must preserve attribution and source metadata.

## 3. Board-game world

Make the Dashboard a visual board.

```text
                    FINAL EXAM
                         |
                    +----+----+
                    | DAY 20  |
                    +----+----+
                         |
             +-----------+-----------+
            /                         \
          DAY 17                     DAY 19
            |                         |
          DAY 16                    DAY 18
            |                         |
     +------+------+------+------+------+ 
    D10    D11    D12    D13    D14    D15
       \                         /
        +----+----+----+----+----+
        D5   D6   D7   D8   D9
                 |
          D1 -> D2 -> D3 -> D4
                 |
             DIAGNOSTIC
```

Each node is a Quest. The player character visibly moves to the active node.

## 4. Board node types

Implement:
- Normal Quest
- Skill Quest
- Vocabulary Quest
- Paraphrase Quest
- Review Quest
- Mini Boss
- Boss
- Final Boss

Examples:
- TFNG Hunt
- Paraphrase Hunter
- Listening Distractor Trap
- Thesis Builder
- Speaking Expansion

## 5. 20-day campaign

Day 1: Diagnostic

Days 2–4: weakness discovery

Day 5: Mini Boss

Days 6–9: 80/20 training

Day 10: Mid Boss

Days 11–14: targeted repair

Day 15: Full Mock

Days 16–18: critical repair

Day 19: final preparation

Day 20: Final Simulation

After every substantial attempt, recompute priorities.

## 6. 80/20 engine

Do not only calculate percentage correct.

Suggested priority:

```text
priority =
    gap_to_target
    * error_rate
    * frequency
    * score_impact
    * recency
```

Normalise components to 0–1.

Example:

```text
Reading / TFNG
gap_to_target = 0.80
error_rate    = 0.45
frequency     = 0.90
score_impact  = 0.90
recency       = 1.00
=> HIGH PRIORITY
```

The board should spend most practice time on high-impact weaknesses while maintaining other skills.

## 7. D1 learner memory

Remember:

```text
user_id
skill
question_type
topic
difficulty
attempts
correct
wrong
accuracy
average_time
last_attempt
streak
error_pattern
priority
confidence
```

Vocabulary:

```text
word
meaning
part_of_speech
example
collocations
synonyms
first_seen
last_reviewed
review_level
accuracy
```

Writing:

```text
task
prompt_id
submission
estimated_band
task_response
coherence
lexical_resource
grammar
errors
```

Speaking:

```text
part
topic
transcript
fluency
lexical_resource
grammar
pronunciation_note
```

## 8. Quest generation

Generate a Quest from actual D1 evidence.

Example:

```text
TFNG accuracy = 54%
Matching Headings = 61%
Vocabulary paraphrase = 48%

Priority:
1. TFNG
2. Paraphrase
3. Matching Headings
```

Create:

```text
THE PARAPHRASE HUNT
Objective: identify TRUE / FALSE / NOT GIVEN
Reward: XP + coins + skill item
```

Never generate a random quest when enough learner data exists.

## 9. Timed exercise system

Every timed Quest must show:
- timer
- progress
- start timestamp
- end timestamp
- time per question
- automatic submission at limit
- warnings at 50%, 75%, 90%, 100%
- local autosave before network sync

Example:

```text
QUESTION 7 / 20
08:31

[ question ]
[ answer ]

NEXT ->
```

## 10. Objective scoring

For Reading and Listening, use the authoritative answer key whenever available.

Store:

```text
source_answer
user_answer
is_correct
time_spent
```

Do not ask AI to decide an objective answer if a trusted answer key exists.

Any raw-score-to-band conversion must be clearly labelled as a practice estimate, not an official IELTS result.

## 11. Writing scoring

Use the four public IELTS dimensions:
- Task Response / Task Achievement
- Coherence and Cohesion
- Lexical Resource
- Grammatical Range and Accuracy

Return structured feedback:

```json
{
  "estimated_band": 7.0,
  "criteria": {
    "task_response": "...",
    "coherence": "...",
    "lexical": "...",
    "grammar": "..."
  },
  "errors": [],
  "next_actions": []
}
```

Always label it as an AI/practice estimate.

## 12. Speaking scoring

Use:
- Fluency and Coherence
- Lexical Resource
- Grammatical Range and Accuracy
- Pronunciation

If only a transcript is available, do not claim to accurately assess pronunciation. State that audio is required for meaningful pronunciation assessment.

## 13. MAIN FEATURE — PARAPHRASE FORGE

Create a dedicated game mode named:

**Paraphrase Forge**

The learner sees a Vietnamese sentence.

Example:

```text
Chính phủ nên đầu tư nhiều hơn vào giáo dục đại học.
```

The target English sentence is initially hidden.

Target example:

```text
The government should invest more in higher education.
```

Instead show first letters and character slots:

```text
T__
g_________
s_____
i_____
m___
i_
h______
e_________
```

The learner types one character at a time.

## 14. Character-by-character input

Each target word is a group of individual character slots.

Example:

```text
government
__________
```

Show only the first letter:

```text
g_________
```

Requirements:
- each character is an individual slot
- underline each slot so word length is obvious
- focus is always on the current slot
- correct character turns green
- incorrect character turns red
- wrong character does not advance
- correct character advances automatically
- spaces advance automatically
- case comparison is case-insensitive

## 15. Avatar movement

The player character must visibly move to the next slot.

Example:

```text
g o _ _ _ _ _ _ _ _
  ^
 avatar/current position
```

Implementation idea:

```text
currentIndex
  -> getBoundingClientRect() of target slot
  -> animate avatar to slot
  -> focus next input
```

Use CSS transitions or Web Animations API.

Do not make animation slow enough to interrupt learning.

## 16. Wrong-answer behaviour

Correct:

```text
[g] -> green
```

Wrong:

```text
[x] -> red
```

The learner remains on the same slot.

Do not immediately reveal the correct character.

After configurable failed attempts, give a hint.

Example:

```text
Attempt 1: wrong
Attempt 2: wrong
Attempt 3:
Hint: think of a synonym for "large"
```

Reveal the full answer only after the configured number of failed attempts.

## 17. Word completion

When a word is complete:

```text
government
██████████
```

Play a short success animation, then move to the next word.

When the sentence is complete:

```text
SENTENCE FORGED

Accuracy: 100%
Time: 00:21

Vocabulary:
- invest in
- higher education
```

Then show why the paraphrase works.

## 18. Paraphrase difficulty

Level 1: direct vocabulary

Level 2: synonym substitution

Level 3: grammatical transformation

Level 4: mixed transformation

Level 5: IELTS Reading paraphrase recognition

Level 6: IELTS Writing sentence production

## 19. Strict vs flexible mode

Strict mode:
- controlled vocabulary drills
- exact expected answer
- useful for character-by-character practice

Flexible mode:
- real paraphrasing
- multiple valid answers
- AI evaluates semantic equivalence, grammar, naturalness and lexical quality
- never mark a valid alternative wrong simply because it differs from the reference

## 20. Vocabulary integration

Every Paraphrase Forge item should link to vocabulary.

Example:

```text
Chính phủ cần giảm sự phụ thuộc vào nhiên liệu hóa thạch.

The government needs to reduce its reliance on fossil fuels.
```

Extract:

```text
reduce
reliance
fossil fuels
```

Add those items to the learner's review queue.

## 21. Spaced repetition

Vocabulary states:

```text
new
learning
review
mastered
```

Default review checkpoints:

```text
Day 0
Day 1
Day 3
Day 6
Day 10
Day 15
Day 20
```

Adjust based on performance.

Repeated failure moves an item backward.

Repeated success moves it toward mastery.

## 22. Rewards

Use:
- XP
- coins
- character cosmetics
- titles
- badges
- map unlocks
- quest completion
- streaks

Do not use gambling-like mechanics or paid random loot.

Rewards should represent learning progress.

## 23. Result + direction after every Quest

Every Quest ends with:

```text
QUEST RESULT

Score: 16/20
Accuracy: 80%
Time: 08:42

Strong:
- vocabulary recognition

Weak:
- TFNG inference
- negative paraphrases

NEXT BEST ACTION:
1. 10 TFNG questions
2. 5 paraphrase drills
3. Review 8 weak vocabulary items

Estimated time: 22 minutes
```

The learner should always know what to do next.

## 24. Source strategy

Priority:
1. Official IELTS material
2. Licensed material
3. Public-domain material
4. User-provided material with permission
5. Permitted third-party material
6. AI-generated material only when necessary

For every source store:

```text
source_name
source_url
test_type
section
question_type
question_id
answer_key_url
license/copyright note
```

Do not mass-copy copyrighted IELTS books, paid courses, websites or Facebook posts without permission.

For Facebook:
- store link + attribution where appropriate
- use only content the application has permission to use
- do not mass-copy posts/comments
- if storing an excerpt, keep it within permitted use and preserve attribution

## 25. Source database

Create:

```sql
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  title TEXT,
  source_name TEXT,
  url TEXT UNIQUE,
  source_type TEXT,
  license_note TEXT,
  date_added TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  skill TEXT,
  section TEXT,
  question_type TEXT,
  prompt TEXT,
  options_json TEXT,
  answer TEXT,
  explanation TEXT,
  difficulty INTEGER,
  FOREIGN KEY(source_id) REFERENCES sources(id)
);
```

Do not expose answer keys to the client before submission.

## 26. Required D1 tables

Add:

```sql
CREATE TABLE question_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  quest_id TEXT,
  user_answer TEXT,
  correct_answer TEXT,
  is_correct INTEGER,
  time_ms INTEGER,
  error_type TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  day INTEGER,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  skill TEXT,
  priority REAL,
  difficulty INTEGER,
  status TEXT DEFAULT 'locked',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quest_attempts (
  id TEXT PRIMARY KEY,
  quest_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score REAL,
  accuracy REAL,
  time_ms INTEGER,
  hints_used INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vocabulary_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  vocabulary_id TEXT NOT NULL,
  correct INTEGER,
  time_ms INTEGER,
  review_level INTEGER DEFAULT 0,
  next_review_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE paraphrase_items (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  difficulty INTEGER DEFAULT 1,
  source_vocab_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  achievement_key TEXT NOT NULL,
  unlocked_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, achievement_key)
);
```

## 27. AI adaptive loop

Pseudo-code:

```text
afterQuest(result):
    save(result)
    updateSkillStats()
    updateQuestionTypeStats()
    updateVocabularyMemory()
    priorities = calculate80_20()

    if priorityChanged:
        rebuildNextQuest()
    else:
        continueCampaign()
```

## 28. Board progression

Normal Quest:
- >=70%: unlock next
- >=85%: bonus XP
- >=95%: mastery bonus

Repeated failure:
- reduce difficulty
- provide prerequisite Quest
- retry

Do not block the entire campaign because of failure.

## 29. Boss mechanics

Bosses are timed and should use a controlled source pool.

Example:

```text
TFNG DRAGON
20 questions
25 minutes
No hints
```

After Boss:
- accuracy
- time management
- question-type breakdown
- error breakdown
- next training recommendation

## 30. Final Boss

Day 20:

```text
Reading: 60 min
Listening: approximately 30 min
Writing: 60 min
Speaking: 11–14 min
```

Use realistic test conditions.

Final results must be labelled as practice/AI estimates, not official IELTS scores.

## 31. Dashboard HUD

```text
Lv 14   XP 2,840   Streak 7   Coins 720

Target:
R 9.0  L 9.0  W 8.0  S 8.0

Current:
R 7.5  L 7.0  W 6.5  S 6.5

TODAY'S 80/20 PRIORITY
Writing — Task Response
Speaking — Fluency
Listening — MCQ
Reading — Maintenance
```

## 32. UX principle

The learner should feel:

> "I am playing a game."

while the system is actually performing:

- diagnosis
- retrieval practice
- spaced repetition
- adaptive learning
- timed IELTS practice
- error analysis

The educational mechanism should remain intuitive.

## 33. Definition of Done

The feature is complete when the learner can:

1. Enter Day 1.
2. Take a diagnostic.
3. Receive an 80/20 profile.
4. See a board with unlocked quests.
5. Enter a timed quest.
6. Answer questions.
7. Receive objective scoring where an answer key exists.
8. Receive AI feedback where appropriate.
9. Gain XP and rewards.
10. Save results to D1.
11. Automatically detect weaknesses.
12. Receive a next-best action.
13. Play Vocabulary Quest.
14. Play Paraphrase Forge.
15. See the first letter of each target word.
16. See the exact character length.
17. Type one character at a time.
18. See correct characters turn green.
19. See wrong characters turn red.
20. Have the avatar move to the next character after successful input.
21. Complete words and sentences.
22. Add important vocabulary to review automatically.
23. Review vocabulary with spaced repetition.
24. Fight Mini Bosses.
25. Fight Skill Bosses.
26. Complete the Final Boss on Day 20.
27. Receive a final practice profile and next-step plan.

## 34. Most important implementation rule

Never build:

```text
AI generates random questions
    -> player answers
    -> XP
```

Build:

```text
REAL / AUTHORITATIVE SOURCE
    -> QUESTION
    -> TIMED ATTEMPT
    -> OBJECTIVE RESULT
    -> D1 MEMORY
    -> 80/20 ANALYSIS
    -> PERSONALISED QUEST
    -> SPACED REVIEW
    -> BOSS
    -> NEW DIAGNOSTIC
```

This is the core architecture for the 6.5 -> 8.0 campaign.
