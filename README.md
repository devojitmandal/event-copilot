# Event Copilot

A budget-first GenAI planning assistant for weddings, birthdays and community events. Built for Hack2Skill PromptWars Virtual, Challenge 5, by Devojit.

**Live demo:** https://event-copilot-three.vercel.app/

## The problem
Planning an event on a fixed budget is a juggling act: a guest count, a date, a stack of vendor quotes, and a budget that has to keep adding up when any of them changes. Generic AI chat gives generic ideas and often gets the arithmetic wrong. Event Copilot keeps the plan consistent as things change.

**Who it's for:** anyone planning a small event on a fixed budget.

## What it does
- **Three modes, one engine:** Wedding, Birthday and Community. Each has its own cost categories, priorities and task templates.
- **City and vibe:** choose from built-in city and vibe options or enter your own. They shape the AI's ideas.
- **Adaptive budget:** costs are either fixed or per guest. Change the guest count and only per-guest items move. Cut the budget by a percentage and the lowest-priority items are trimmed first, never below a set minimum. A reserve is held back for surprises.
- **AI plan (Gemini):** a summary, ideas that fit the budget, city and vibe, an explanation for each budget cut, and the main risks.
- **Timeline:** tasks counted back from the event date, with overdue and due-soon flags that update when the date moves. Tasks can be ticked off.
- **Vendor quotes:** add several quotes per category, see which is lowest and how far each is over or under plan, book one, and see projected spend against the available budget.
- **AI quote extraction:** upload a PDF or image of a quotation. Gemini drafts the vendor, category, price, inclusions, exclusions and payment terms. The user reviews and edits everything before it is saved. Total-versus-per-guest prices are converted and flagged.

## Key design decision: AI explains, code calculates
Gemini never does arithmetic. The server computes every budget figure with deterministic, tested code, sends the final numbers to Gemini, and asks only for explanations, ideas and risks. The model's reply is validated against a schema before it reaches the screen. If the AI is unavailable or returns something invalid, the app shows a template plan that is clearly labelled as not written by AI, with the reason.

## How AI is used in the app
1. **Plan generation:** the server builds the plan from the user's inputs, then prompts Gemini with the final numbers. The prompt tells the model not to change them, to treat user notes as data and to refer to items by their label. The reply must be JSON matching a schema.
2. **Quote extraction:** the uploaded file and the plan's category list go to Gemini with an instruction to treat the file's content as untrusted data and to return null instead of guessing. The draft is validated, a category that isn't in the plan is discarded, and the user confirms before anything is saved.

## Architecture
```
Browser (React + Vite + TypeScript)
   |  POST /api/plan        POST /api/extract
   v
Vercel serverless functions (api/plan.ts, api/extract.ts)
   |  validate input -> compute numbers -> prompt Gemini -> validate output
   v
Gemini API (the key stays on the server)
```
- `src/lib/` budget engine, templates, timeline and vendor logic (pure functions)
- `src/server/` request handlers, prompts, schemas and Gemini calls
- `api/` thin Vercel function wrappers
- `src/test/` Vitest unit tests

## Security and privacy
- The Gemini API key is only read on the server and is never sent to the browser.
- Every request is validated with zod (value ranges, allowed modes, size limits). Plan requests are capped at 4 KB.
- Free-text fields are sanitized and passed to the model as data, not instructions.
- Uploaded files: type allowlist (PDF, PNG, JPG, WebP), 3 MB limit, and a file-signature check so a renamed file can't pass.
- AI output is schema-validated. Nothing from an extraction is saved until the user confirms it.
- AI text is rendered as plain text by React, so it cannot inject HTML.
- Rate limits (10 plan requests and 5 uploads per minute per IP) and a 10-minute cache for identical plan requests.
- Uploaded quotations are sent to the Google Gemini API for extraction and are not stored by this app. Please don't upload documents that contain personal or financial identifiers.

## Efficiency
AI runs only when the user clicks. Identical plan requests are cached. Gemini calls have short timeouts and one retry on temporary errors, so the app falls back to a labelled template instead of hanging.

## Limitations
- Prices are template-based estimates, not verified local quotes. Users enter real quotes.
- Rate limiting and caching are per server instance (in memory), so they are best-effort protection.
- Quotes, ticked tasks and generated plans are not saved after a page refresh.
- Quote totals do not add taxes that a quote lists as excluded.
- The free Gemini tier can be busy. The app degrades gracefully, but responses may be slower.

## Run locally
```
git clone https://github.com/devojitmandal/event-copilot.git
cd event-copilot
npm install
```
Create a `.env` file in the project root:
```
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-flash-lite-latest
```
Then:
```
npm run dev      # start the app with the API routes
npm test         # run the unit tests
npm run build    # type-check and build
```
`GEMINI_API_KEY` is needed for the AI features. Without it the app still runs and shows the template plan. `GEMINI_MODEL` is optional.

## Tests
Vitest unit tests cover the budget engine (cut order, minimums, per-guest scaling), the timeline, vendor comparison, price-unit conversion, request and output validation, caching, rate limiting, file checks and fallback behaviour.

## Tech
React, Vite, TypeScript, Vercel serverless functions, Gemini API, zod, Vitest.

## Built with
Claude, Cursor and Google Antigravity.