# Take-Home: Dashboard Agent

**Role:** Senior Software Engineer, Applied AI **Effort:** \~6 hours of work. Five calendar days to return it. **Follow-up:** 45-minute debrief with two engineers.

# Why this exercise

A dashboard agent sits between a person and a dataset. Someone asks a question in plain language; the system works out how to answer it, computes a number, and draws something. The engineering problem is not getting a model to produce a chart. It is building a system whose numbers someone is willing to act on — reallocate a budget, cut a line item, defend the figure in a meeting where they did not do the analysis themselves.

That is the problem we want to see you take a slice of. We have used a marketing dataset because it is a domain most engineers can reason about without a briefing. The domain is incidental. The trust problem is the exercise.

# The problem

Build a **dashboard agent**: it takes a natural-language question about the provided dataset, works out how to answer it, and returns an answer with a visual.

A working session should look roughly like:

The dataset is in data/ — four CSVs, about 2,350 rows of daily ad performance covering 8 June to 4 September 2026\.

Schema is at the bottom of this document.

**One thing you should know:** this is shaped like a real extract, and it has the defects real ad data has. We did not clean it up for you. Part of the exercise is what you do about that.

# Part 1 — Design (the part we read most carefully)

Three to four pages. Diagrams welcome, prose is fine, no template.

Design the production version of this system — not the MVP you are about to build, the real one, running multi-tenant for a few hundred teams. Cover:

1. **The request path.** Component by component, from question to rendered answer. Be specific about where the LLM sits — and where you deliberately kept it out.

2. **Fixed vs. decided.** Which steps do you hard-code, and which do you let the model choose at runtime? Give us your rule for drawing that line, not just where you drew it.

3. **Trust.** A user asks for last quarter's ROAS and gets a number. What stands between the model and that number to make it correct? What happens when it is wrong anyway — how would you even find out?

4. **Isolation.** Every tenant sees only their own data. Where does that break? Name the places you would expect a leak, including the non-obvious ones.

5. **Not knowing.** Some questions cannot be answered from the data available. How does the agent establish that, and what does it say?

6. **Cost and latency.** 500 users, \~20 questions a day each. What is the monthly bill, roughly, and which component dominates it? Where would you attack it first?

7. **Change safety.** You improve a prompt on Friday. On Monday someone says answers got worse. How do you determine whether they are right?

8. **Cuts.** What did you leave out of v1 on purpose, and what do you expect that to cost you later?

We care more about how you reason through 2, 3 and 8 than about the box diagram.

# Part 2 — MVP

A narrow slice, running. We would rather see one path that genuinely works than five that mostly do.

#### **Must do:**

* Run from a clean checkout by following your README. One command is ideal.

* Accept a question and return an answer with **a chart** and **a short written finding**. CLI, notebook, or a rough web UI — we have no preference.

* **Show its work.** Whatever query or transformation produced the number should be visible in the output. We will be checking your numbers.

* Handle the five questions in the next section. Getting one of them *right* is worth more than getting all five

  *plausible*.

* Include an automated check — however small — that tells you whether the agent still answers correctly after you change something. Three cases is enough. We want to see the mechanism, not a suite.

**Do not bother with:** authentication, deployment, CI, multi-user anything, a designed UI, or a framework you would not otherwise reach for. None of it scores.

Any language, any stack, any model provider. If you use an agent framework, fine. If you write the loop yourself, also fine

— and say why in the design doc.

# The five questions

Your MVP should handle these. They are not all the same difficulty, and at least one of them is not straightforward.

1. What did we spend by channel over the last eight weeks?

2. Which campaign generated the most revenue this quarter?

3. Conversions look like they fell off a cliff on the most recent day. What happened?

4. Which campaign should we turn off?

5. How does our spend compare to our competitors'?

# How we score it

## **Weight	What we are looking at**

**30	Architecture and tradeoffs** — is the design coherent, and did you argue the alternatives you rejected?

**30	Correctness and trust** — right numbers; a system that catches itself being wrong; honest about limits

**15	Scoping** — did you cut the right things and say so, or run out of time everywhere at once?

**15	Code craft** — could a colleague work in this on Monday? Is anything tested?

**10	Communication** — README, design doc, commit messages

If you hit six hours and are not finished, **stop.** Write down what you would do next and why. A clean partial submission with clear reasoning about the gaps scores above a sprawling complete one. Judgement about scope is part of what we are hiring for.

# The debrief

45 minutes, so you can prepare:

* **15 min** — walk us through it, running.

* **20 min** — decisions and extensions. Expect "why not X instead?", at least one question about a number your agent produced, and one about how you would extend it to something you did not build.

* **10 min** — your questions for us.

Use whatever tools you normally use to build this, AI assistants included — that is how the job works and we are not testing you against a blank editor. But you will be asked to defend the design in detail, so make sure you would ship it.

# Submitting

A git repo (link or zip) containing:

* README.md — how to run it, what works, what does not

* DESIGN.md — Part 1

* the code, the tests, and the data/ directory as provided

# Appendix — data dictionary

data/ad\_performance\_daily.csv — one row per campaign / creative / day

## **column	notes**

### date	YYYY-MM-DD

campaign\_id	→ campaigns.csv

creative\_id	→ creatives.csv impressions, clicks, conversions integers

spend, revenue	**in the campaign's own currency**

### currency	INR or USD

data/campaigns.csv — campaign\_id, campaign\_name, channel, objective, currency, daily\_budget, start\_date, end\_date (blank \= still running)

data/creatives.csv — creative\_id, campaign\_id, creative\_name, format, headline, launched\_on data/fx\_rates.csv — date, currency, rate\_to\_usd (daily)

Channels: google\_search, meta, youtube, linkedin. Objectives: conversions, traffic, awareness.

Questions about the brief are welcome and are not held against you — ask.

