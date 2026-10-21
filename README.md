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

## Run
```
npm install
npm run dev
npm test
```

## Notes
Prices are estimates, not verified local quotes. The Gemini API key must stay server-side (see `.env.example`).
