# Event Copilot

Budget-first GenAI planning assistant for weddings, birthdays and community events. Built for Hack2Skill Challenge 5.

## Idea
One shared planning engine, three event modes. Change the budget, guest count or priorities and the plan adapts. Gemini recommends and explains trade-offs; deterministic code does all the arithmetic.

## Status
- [x] Budget engine (fixed vs per-guest costs, priority-based cuts with floors) with tests
- [x] Mode templates (wedding, birthday, community)
- [x] Basic UI shell
- [ ] Gemini server route returning validated JSON plan
- [ ] Timeline counted back from the event date
- [ ] Vendor checklist and quotes
- [ ] Risk checker
- [ ] PDF export

## Privacy and data handling
- Uploaded quotations are sent to the Google Gemini API for extraction. The app does not store them.
- Files are validated (type allowlist, 3 MB limit, file-signature check) before being sent.
- Extracted details are only saved after the user reviews and confirms them.
- Please don't upload documents containing personal details such as ID or bank numbers.
- API keys stay on the server and are never sent to the browser.

## Run
```
npm install
npm run dev
npm test
```

## Notes
Prices are estimates, not verified local quotes. The Gemini API key must stay server-side (see `.env.example`).
