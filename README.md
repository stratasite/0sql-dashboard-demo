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
deploy Customer Service Analytics (4655 bytes) as customer-service/main (the production branch) to https://app.0sql.io
deployed customer-service/main: 3 tables, 110 fields, 2 joins, 136 paths, 1 policies
PASSED average handle time by day
PASSED contacts by call center
tests: 2 passed, 0 failed
```

`npm run check:model` validates without deploying. If the app's header shows a
setup line, it tells you which of the three steps is missing.

## Things to ask it

- *Which call centers have the longest average handle time?*
- *Contacts per week over the last three months*
- *Top 5 ticket dispositions by volume, and pin it to the dashboard*
- *How does total contact cost split by BPO vendor?*
- *Compare answered contacts to abandoned ones by region, month over month*
- *Drop the resolution mix tile*

Open **spec** and **planned sql** under any answer. The spec is what the model
wrote; the SQL is what 0sql planned from it, against this model, for this user.

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

Switch user, ask the same question, and read the planned SQL. The agent's
prompt did not change, and could not have changed the outcome: the context is
attached on the server after the spec exists, and the policy is enforced by the
planner. That is the part a text-to-SQL agent cannot give you.

## How it works

| File | What it does |
|---|---|
| `src/lib/agent.ts` | the loop: stream a turn, run the tools it asked for, feed the results back |
| `src/lib/providers/` | the model seam: `anthropic.ts`, `openai.ts`, and the driver interface |
| `src/lib/tools.ts` | the five tools, their Zod schemas, and what each one does |
| `src/lib/zsql.ts` | the 0sql client: `/sql`, `/explore`, `/fields`, `/tables` |
| `src/lib/warehouse.ts` | runs the planned statement on DuckDB |
| `src/lib/catalog.ts` | the field list in the system prompt, read from `/fields` at runtime |
| `src/lib/tiles.ts` | the dashboard: specs on disk, never SQL |
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
│   └── rel.contact.yml                the two joins, with cardinality
└── tests/                             planner assertions, run on every deploy
```

One fact table at contact grain; 110 fields in all, 34 of them measures:
volume (`Contacts`, `Answered Count`, `Abandoned In SLA Count`), durations (`Talk
Duration Secs`, `ACW Duration Secs`, `Average Contact Duration Secs`),
outcomes (`Ticket Resolution Gate`, `Chat End State`), and cost (`CSR1 Cost
USD`, `Telecom Cost USD`, `Total Contact Cost USD`). `Escalating Call Center` is
the same physical table joined on a second key — a role-playing dimension, so
"which site escalated to which" is one spec, not a self-join you hand-write.

Edit a file, `npm run check:model`, deploy. The app picks it up on the next
question; no code changes.

## The warehouse

`warehouse/data/*.parquet` holds 5,000 synthetic contacts across nine call
centers in three regions, and `npm run seed` loads them into
`warehouse/cs_warehouse.duckdb`, shifting every date so the latest contact is
today. The data is generated; there is nothing real in it.

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
