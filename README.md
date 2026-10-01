# IELTS 20-Day Accelerator — 8.0 checkpoint / 8.5 stretch

Target: 6.5 → Overall 8.0 minimum (R≥8.5, L≥8.5, W≥7.5, S≥7.5), stretch Overall 8.5 (R9/L9/W8/S8).
Note: R9+L9+W8+S8 averages 8.5, not 8.0 — the app shows both tiers to avoid confusion.

https://ielts-20-day-accelerator.lupindsama.workers.dev

## Spec implementation (IELTS_20_Day_Board_Game_AI_Spec.md)

- Timed quests with answer keys (`/api/quest/start`, `/api/quest/submit`): objective scoring, warnings at 50/75/90/100%, autosave, auto-submit, progression (70% unlock, 85/95% bonus), quest result + next-best action.
- Question bank with attribution (`/api/questions`, `/api/sources/seed`); keys never leave the server.
- Day-1 diagnostic (`/api/diagnostic/submit`) producing a normalized 5-factor 80/20 profile (gap, error, frequency, impact, recency).
- Paraphrase Forge: strict char-by-char mode + flexible AI-judged mode (`/api/forge/item`, `/api/forge/complete`, `/api/forge/flex`), vocab auto-queued to Day 0/1/3/6/10/15/20 spaced repetition (`/api/review/*`).
- AI chain: up to 3 Gemini keys rotated via secrets (`AI_API_KEY`, `AI_API_KEY_2`, `AI_API_KEY_3`), Workers AI fallback, JSON repair + retry.

## Verify

- `npm.cmd run typecheck` (tsc)
- `npm.cmd test` (48 API + parser + key-rotation cases on real in-memory SQLite)

## Stack
- Cloudflare Workers: serverless API + static frontend
- Cloudflare D1: progress, vocabulary, quizzes, writing/speaking history
- Cloudflare Workers AI: vocabulary generation, quizzes, paraphrasing and feedback
- Optional future: R2 for audio/assets, Vectorize for a larger source/RAG bank

Cloudflare documents Workers + D1 + Workers AI as a serverless architecture. D1 is SQLite-compatible and Workers AI runs models on Cloudflare's serverless GPU infrastructure.

## Setup
1. Install Node.js.
2. `npm install`
3. Create a D1 database:
   `npx wrangler d1 create ielts_20_day`
4. Put the returned database ID into `wrangler.toml`.
5. Apply schema:
   `npm run db:migrate:remote`
6. `npx wrangler dev`
7. Deploy:
   `npm run deploy`

## Important content-source rule
The source bank stores URLs and short excerpts/metadata. Do not mass-copy copyrighted IELTS books, websites, or Facebook posts. Prefer official IELTS sample tasks, public-domain/licensed content, or material you have permission to use. You can later add an ingestion worker that fetches allowed URLs and stores attribution + a limited excerpt.

## Production upgrades
- Add Cloudflare Access or a real authentication layer.
- Replace `demo-user` with authenticated user IDs.
- Add rate limiting/AI Gateway.
- Add R2 for audio recordings.
- Add Vectorize/AI Search for RAG over licensed source material.
- Add spaced-repetition scheduling (SM-2/FSRS) to flashcards.
- Add Reading/Listening answer engines and error taxonomy.
- Add a 20-day adaptive planner that changes tomorrow's tasks based on error history.
