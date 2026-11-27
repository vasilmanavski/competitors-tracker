# How I'd use the LLM with real data: competitor trends
I built per-change summaries because the brief asks for them. Testing on Ollama, though, I noticed **the AI mostly restates a change you can already read in the old → new diff**. The fixtures are short one-liners. On real listings a rewritten paragraph is harder to read by eye, so I'd check this with real data and real users first.

If it holds up, I'd spend the budget differently:
- **Show the changes with plain code:** a highlighted diff per field, plus the code summaries that already exist.
- **Use a bigger model for what LLMs are actually good at:** a **trend summary per competitor**. A per-change summary answers "what changed?". A product manager wants to know "where is this competitor heading?". One change says little, but ten over two months show a pattern.

How I'd build it:
- **Input:** the list of changes with dates and old → new values, not raw snapshots. Retention keeps changes for good, so the history is always there.
- **On demand:** a "What's the trend?" button, `GET /api/competitors/:id/trend`. The result is stored until the competitor's next change, so competitors nobody opens cost nothing. It shares the daily cap.
- **Its own model:** `LLM_TREND_MODEL`, e.g. `qwen2.5:7b`. A slower answer is fine for something you ask for.

I tried it on llama3.2 with `orbit-hr`'s four changes (€8 → €10/seat/mo → €96/yr → free for teams under 10, and the tagline going from "HR for teams of 10 to 500" to "HR for growing teams"). It got the big picture right: a free tier for small teams and broader positioning. It got two details wrong. It called €96/yr "more premium", but that's €8/mo, so it's cheaper. And it cited the wrong change for the tagline. So before building it, I'd:
1. Do the maths in code and send `€10/seat/mo → €96/yr (≈ €8/mo, −20%)`, never raw prices.
2. Check every cited change in code, and reject the answer if a citation is wrong.
3. Label it in the UI as an AI interpretation, with links to the changes it cites.

I didn't build it: it goes beyond the brief (summaries between consecutive snapshots), and the mock would only echo the prompt back.
