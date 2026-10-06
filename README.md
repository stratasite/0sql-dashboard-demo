# 0sql chat dashboard demo

A custom analytics dashboard where the questions are typed in English and the
SQL is planned by [0sql](https://0sql.io). The model writes a **query spec**;
0sql turns that spec into one correct SQL statement for the warehouse, with
row-level security compiled in; the app runs it and draws it. Say "pin that"
and the answer becomes a dashboard tile. Claude drives it by default and
OpenAI works too — the spec is the contract, not the provider.

```
you ──▶ model ──▶ query spec ──▶ 0sql ──▶ SQL ──▶ your warehouse ──▶ rows ──▶ chart
                      ▲                │
                      └── 422: what's wrong with the spec
```

The model never writes SQL and never sees a connection string. It cannot invent
a join, pick the wrong grain, or step around a security policy, because none of
those are its to decide — they live in a semantic model you deploy. When it does
get a spec wrong, 0sql refuses with a class and a message, and the agent fixes
it on the next turn.

Everything here is open: the dashboard app, the semantic model it queries, and
the synthetic warehouse the SQL runs against.

Walkthrough of how it was built, step by step:
**[0sql.io/docs/examples/chat-dashboard/](https://0sql.io/docs/examples/chat-dashboard/)**

---

## What you need

- Node 22 or newer (`.nvmrc` pins 22)
- A 0sql account, and two keys from [app.0sql.io](https://app.0sql.io):
  a **personal key** (`zsk_…`) to deploy the model, and a **query key** (`zqk_…`),
  granted this project, for the app to query with. The query key is read only —
  it can plan and discover and nothing else, which is what an application
  should carry
- A model key: Anthropic ([console.anthropic.com](https://console.anthropic.com))
  or OpenAI ([platform.openai.com](https://platform.openai.com)) — either one
  drives the agent, see [Which model](#which-model)
- The `zsql` CLI, to deploy the model once:
  ```sh
  curl -fsSL https://0sql.io/install.sh | sh
  ```

No warehouse needed. The repo ships one.

## Quick start

```sh
git clone https://github.com/stratasite/0sql-dashboard-demo
cd 0sql-dashboard-demo
npm install

# 1. build the DuckDB warehouse from the Parquet files in warehouse/data.
#    Dates are re-anchored on today, so "last 28 days" always has rows.
npm run seed

# 2. deploy the semantic model to your own 0sql account, with your own
#    personal key. `zsql auth` writes it to semantic/.zsql, which is gitignored.
zsql auth --project semantic --api-key zsk_… --server https://app.0sql.io
npm run deploy:model

# 3. keys for the app: the query key goes in ZSQL_QUERY_KEY.
cp .env.example .env.local

npm run dev                  # http://localhost:3000
```

The deploy prints what landed:

```
deploy Customer Service Analytics (23302 bytes) as customer-service/main (the production branch) to https://app.0sql.io
deployed customer-service/main: 26 tables, 532 fields, 32 joins, 3091 paths, 1 policies
PASSED average handle time by day
PASSED handling and escalating sites join separately
PASSED contacts by call center
PASSED cost per contact is one pass over the fact
PASSED escalation rate excludes transfer-outs
PASSED escalating call center joins on its own key
tests: 6 passed, 0 failed
```

`npm run check:model` validates without deploying. If the app's header shows a
setup line, it tells you which of the three steps is missing.

## Things to ask it

- *Which call centers have the longest average handle time?*
- *Contacts per week over the last three months*
- *Top 5 ticket dispositions by volume, and pin it to the dashboard*
- *How does total contact cost split by BPO vendor?*
- *Compare answered contacts to abandoned ones by region, month over month*
- *Show me AHT, ASA and service level by call center for the last 3 months*
- *Which sites have the worst cost per contact, and how does it split by vendor?*
- *Drop the resolution mix tile*

Open **spec** and **planned sql** under any answer, and under any dashboard
tile. The spec is what the model wrote; the SQL is what 0sql planned from it,
against this model, for this user. On a tile the SQL was planned when the panel
last loaded, so it is not a record of what once ran — it is what runs now.

While a question runs, the status line says which phase it is in and how long it
has been there — `thinking`, `run_query`, `writing` — and **stop** (or `Esc`)
cancels it. Stopping aborts the model call itself, not just the browser's half:
the exchange so far is kept, and the conversation records that the answer was
cut off, so the next question is not answered alongside the abandoned one.

When a question finishes, the **trace** line under the answer opens into where
the time and the tokens went:

```
trace · 15.63s · 3 model turns · 10.4k prompt / 969 out
  field catalogue                                                        81ms
    GET /fields, memoized
  model turn 1 · claude-opus-5                                          5.43s
    first token 4.57s · asked for run_query
    prompt 3,148 · output 301 · of it reasoning 193
    context 14.8 KB sent — system 5.7 KB · tools 9.0 KB · conversation 83 B
  tool run_query                                                          70ms
    0sql plan 63ms · warehouse 7ms
  total                                                                 15.63s
    model 15.41s · tools 121ms · elsewhere 93ms
    10,405 prompt tokens (59% from cache) · 969 output
```

Every number is measured rather than estimated: the timings come from the server
as each phase finishes, the token counts from whichever provider ran the turn.
Two of them are worth watching. **`0sql plan` against `warehouse`** says which
half of a slow query to blame. And **cache read** should climb to most of the
prompt by the second turn — if it does not, something made the prompt prefix
move, and the field catalogue being memoized (`81ms` once, `<1ms` after) is the
reason it usually does not.

## Row-level security, not prompt instructions

The header has a user picker. Each demo user carries a security context — an
email and groups with `region:` tags (`src/lib/users.ts`), standing in for your
session.

`semantic/security.yml` holds one policy: any query touching a measure tagged
`cost-sensitive` is filtered to the call center regions the caller's groups
allow. The filter is compiled into the `WHERE` clause at plan time. So:

| querying as | *total contact cost by call center* |
|---|---|
| Dana — AMER ops | AMER sites only |
| Mo — global finance | every region |
| Sam — floor supervisor | no rows: no region granted |

Open **planned sql** on the *Total contact cost by BPO* tile and switch user
with it still open. The tile re-plans and the `WHERE` clause moves under you:

```sql
WHERE LOWER(T1."region") IN ('amer')                      -- Dana, AMER ops
WHERE LOWER(T1."region") IN ('amer', 'emea', 'apac')      -- Mo, global finance
```

Open **spec** next to it: there is no region filter in there, and there never
was. The agent's prompt did not change and could not have changed the outcome —
the context is attached on the server after the spec exists, and the policy is
enforced by the planner. That is the part a text-to-SQL agent cannot give you.

## How it works

| File | What it does |
|---|---|
| `src/lib/agent.ts` | the loop: stream a turn, run the tools it asked for, feed the results back |
| `src/lib/providers/` | the model seam: `anthropic.ts`, `openai.ts`, and the driver interface |
| `src/lib/tools.ts` | the five tools, their Zod schemas, and what each one does |
| `src/lib/zsql.ts` | the 0sql client: `/sql`, `/explore`, `/fields`, `/tables` |
| `src/lib/warehouse.ts` | runs the planned statement on DuckDB |
| `src/lib/catalog.ts` | the curated field list in the system prompt, read from `/fields` at runtime |
| `src/lib/tiles.ts` | the dashboard: specs on disk, never SQL |
| `src/components/QueryDetails.tsx` | the query behind a chart: spec and planned SQL, on both cards |
| `src/components/TracePanel.tsx` | the collapsible trace: timings, context size, token usage |
| `src/app/api/chat/route.ts` | the chat endpoint, streaming newline-delimited events |
| `src/app/api/tiles/route.ts` | re-plans and re-runs every tile on load |

The five tools the model is given:

| Tool | Does |
|---|---|
| `search_fields` | search the deployed model for dimensions and measures |
| `run_query` | plan a spec with 0sql, run the SQL, show the chart |
| `pin_tile` | pin a query that just ran onto the dashboard |
| `list_tiles` / `remove_tile` | edit the dashboard by name |

Two details worth copying into your own build:

**A tile stores a spec, not SQL.** `/api/tiles` re-plans all of them on every
load. Rename a column, add a join, make a cheaper table available, tighten a
policy — the dashboard follows, because nothing on it is frozen SQL.

**The field catalogue comes from the API.** `GET /fields` is in the system
prompt, memoized and sorted so the prompt prefix stays byte-identical and the
cache keeps hitting. Deploy a new measure and the next conversation knows about
it, with no prompt to edit.

It is curated, because 532 fields is more than a prompt should carry. Every
measure goes inline, grouped by the table it belongs to — measures are the
scarce half, they hold the business definitions, and which fact a measure sits
on is what you need to know before combining two of them. Dimensions go inline
for the contact star and are named by table elsewhere, because a dimension is
easy to find by guessing its name, which is what `search_fields` is for. The
curation lives in the app, not the model: `hidden: true` would drop a field from
`/fields` altogether and make it unreachable by search too.

## The semantic model

`semantic/` is a complete 0sql project — the same thing you would keep in your
own repo:

```
semantic/
├── project.yml                        name, uid, production branch
├── datasources.yml                    one duckdb datasource (adapter only; no secrets)
├── security.yml                       the row-level security policy
├── models/
│   ├── tbl.contact.yml                the fact: one row per customer service contact
│   ├── tbl.call_center.yml            the sites that handled them
│   ├── tbl.escalating_call_center.yml the same table in the escalation role
│   ├── tbl.contact_skill.yml          routing skill: channel, language, tier
│   ├── tbl.contact_subchannel.yml     how the customer reached us
│   ├── tbl.transfer_type.yml          whether and how it was transferred
│   ├── tbl.country.yml                the customer's country, with rollups
│   ├── tbl.agent.yml                  staff, plus four role-playing views of it
│   ├── tbl.agent_history.yml          the roster as it stood on the day
│   ├── tbl.recontact.yml              did the customer come back within 7 days
│   ├── tbl.subscription.yml           memberships, accounts, daily snapshots
│   ├── tbl.hc_*.yml                   help center sessions and content
│   ├── tbl.ab_*.yml                   A/B test allocations
│   └── rel.*.yml                      the joins, with cardinality
└── tests/                             planner assertions, run on every deploy
                                       (only where the query path is ambiguous)
```

26 logical tables over 20 physical ones, 532 fields, 106 of them measures. Five
of those tables are role plays: `Escalating Call Center` is the site table under
a second foreign key, and `Supervisor`, `Manager`, `Current Supervisor` and
`Current Manager` are all the staff table reached by different routes.

The centre of it is the contact fact. Around that sit subject areas a question
reaches only when it asks for them — memberships, A/B allocations, help center
traffic — joined through the customer's account and subscription.

The additive ones are the warehouse as it sits: volume (`Contacts`, `Answered
Count`, `Abandoned In SLA Count`), durations (`Talk Duration Secs`, `ACW
Duration Secs`), outcomes (`Ticket Resolution Gate`, `Chat End State`), cost
(`CSR1 Cost USD`, `Telecom Cost USD`, `Total Contact Cost USD`).

The ones people actually ask for are ratios, and they are published rather than
left to the caller: `AHT Mins`, `ASA Secs`, `ART Secs`, `SLA Rate`, `Abandon
Rate`, `Gateway Abandon Rate`, `Escalation Rate`, `Makegood Rate`,
`Authenticated Rate`, `Cost Per Contact USD`, `Cost Per Minute USD`. That is the
part worth copying. A ratio of two sums is not the average of per-row ratios, so
"average handle time by region" is wrong in a way nobody notices if every client
derives it for itself. Published once, it is computed once — for the dashboard,
for the agent, and for whatever queries the API next. `Agents` and `Accounts
Contacting` are distinct counts, which do not add up across a split; the agent's
prompt says so.

`Escalating Call Center` is the same physical table joined on a second key — a
role-playing dimension, so "which site escalated to which" is one spec, not a
self-join you hand-write. The per-contact averages exclude transfer-outs through
`Major Transfer Type`: the site that handed a contact off did not do the work.

Two routes reach a supervisor, deliberately. `Current Supervisor` hangs off the
agent record — who they report to today. `Supervisor` hangs off the roster,
keyed by the day of the contact — who they reported to *then*. Reorganise the
floor and only one of those changes the answer to "how did this team do last
quarter"; conflating them is the usual way an attribution report quietly goes
wrong.

Naming carries the same weight. `Contact Channel` is how the customer arrived;
`Skill Channel` is what the skill is staffed for. They are the same column in
two tables and were briefly the same dimension, until the planner warned that
the route from a contact to its channel was ambiguous and was resolving through
the skill. Splitting them keeps the disagreement visible instead of averaging it
away. `Country Code` needed the same treatment: four facts each carry one, and
left under one name a contact's country resolved through A/B allocations.

The six tests in `semantic/tests/` are not coverage for its own sake — they
exist only where the query path is ambiguous enough that a wrong answer would
still look right. Two pin the role-playing join to the correct foreign key; one
checks that a measure embedding another field's `CASE` still excludes
transfer-outs; one checks that the compound `Cost Per Contact USD` stays a
single pass over the fact rather than becoming a second scan that double counts.
Note what they cannot cover: tests plan without a security context, so the
row-level policy does not fire inside them. Verify that against the running API,
the way the user picker does.

Edit a file, `npm run check:model`, deploy. The app picks it up on the next
question; no code changes.

## The warehouse

`warehouse/data/*.parquet` holds the full synthetic mart — 20 tables, ~900k
rows, 6 MB — and `npm run seed` loads it into `warehouse/cs_warehouse.duckdb`,
shifting every date so the latest contact is today. The data is generated; there
is nothing real in it.

**Parquet is what ships; the database is not committed.** It is a build output,
rewritten on every seed, and ~9x larger than the same data in Parquet (55 MB
against 6 MB) — a binary that changes every run is the last thing that belongs
in git history. Rebuilding from an immutable source is also what makes the seed
idempotent.

**One shift for the whole warehouse.** Several tables join on a date as well as
a key — an agent's roster day, a membership snapshot — so moving each by its own
offset would quietly empty those joins. The seed derives one offset from the
contact fact and applies it to all 41 date and timestamp columns.

To point the demo at your own warehouse instead: change `adapter` in
`semantic/datasources.yml` (`postgres`, `snowflake`, `bigquery`, `databricks`,
`redshift`, `trino`, `athena`, `clickhouse`, `druid`, `mysql`, `sqlserver`,
`sqlite`), redeploy, and replace `src/lib/warehouse.ts` with your own client.
0sql emits that dialect instead; nothing else in the app moves.

## Which model

Claude by default (`claude-opus-5`), OpenAI if you point it there
(`gpt-5.1`). Set one key and the app uses it; set both and `LLM_PROVIDER`
decides:

```sh
LLM_PROVIDER=openai       # or anthropic
OPENAI_MODEL=gpt-5.1      # or ANTHROPIC_MODEL=claude-opus-5
```

The loop in `src/lib/agent.ts` does not know which it is talking to. It hands a
**driver** (`src/lib/providers/`) a system prompt, the tool list and the
conversation; the driver answers with the text and the tool calls. Each driver
owns the translation to its own API — Anthropic gets `eager_input_streaming` and
a cache breakpoint, OpenAI gets the Responses API with `store: false` — and
nothing else in the app changes.

That seam is cheap for one reason, and it is the reason this demo exists: what
the model produces is **a query spec against a published JSON Schema**, not
prose only one vendor can produce. Swapping the model swaps the thing writing
specs. It does not touch who decides the joins, the grain, the dialect or the
rows this caller may see — that is the semantic layer, and it is the same for
both.

A question costs a few cents. Tune the effort knob in whichever driver you use
(`output_config.effort` for Anthropic, `reasoning.effort` for OpenAI); both sit
at `medium`, and `low` is quicker and cheaper for simple questions.

Conversations are held in memory (`src/lib/conversations.ts`) and tiles in a
JSON file. Both are deliberately the simplest thing that works; swap them for
your session store and your database.

## License

MIT. The synthetic data is yours to use too.
