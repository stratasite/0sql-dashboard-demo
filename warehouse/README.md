# The warehouse

The full synthetic customer service mart: 20 tables, ~900k rows, as Parquet.
`npm run seed` loads them into `cs_warehouse.duckdb` and shifts every date so
the most recent contact lands on today — relative filters like `28d` and `3m`
then answer with rows whenever the repo is cloned.

**One shift for the whole warehouse.** Several tables join on a date as well as
a key — an agent's roster day, a membership snapshot — so moving each table by
its own offset would quietly empty those joins. The seed derives one offset from
`cs_contact_f.fact_utc_date` and applies it to all 41 date and timestamp columns.

**Parquet is what ships; the database is not committed.** It is a build output,
rewritten on every seed, and ~9x larger than the same data in Parquet (55 MB
against 6 MB). Rebuilding from an immutable source is also what makes the seed
idempotent: run it twice and you land in the same place.

| File | Rows | Grain |
|---|---|---|
| `cs_contact_f` | 5,000 | one customer service contact — the fact |
| `cs_recontact_f` | 4,542 | one contact, with its follow-on contact window |
| `cs_ticket_action_f` | 12,568 | one action taken on a ticket |
| `cs_chat_transcript` | 2,280 | one chat transcript |
| `cs_call_center_d` | 9 | one call center site |
| `cs_agent_d` | 195 | one agent, current state |
| `cs_agent_hist_d` | 29,412 | one agent per day — roster history |
| `cs_contact_skill_d` | 24 | one routing skill |
| `cs_contact_subchannel_d` | 6 | one contact subchannel |
| `cs_transfer_type_d` | 5 | one transfer type |
| `geo_country_d` | 26 | one country |
| `account_d` | 3,000 | one customer account |
| `subscrn_d` | 3,217 | one subscription |
| `membership_day_d` | 453,261 | one subscription per day |
| `membership_day_agg` | 321,162 | membership days, pre-aggregated |
| `cs_hc_sess_sum` | 16,108 | one help center session summary |
| `cs_hc_content_sum2` | 39,551 | one help center content summary |
| `ab_test_detail_d_v2` | 12 | one A/B test |
| `ab_member_alloc_d` | 6,069 | one member allocated to a test cell |
| `ab_nm_alloc_f` | 2,531 | one non-member allocated to a test cell |

The data is generated. Nothing in it comes from a real customer, agent or
account.

0sql never reads any of this: it plans SQL from `semantic/`, and the app runs
that SQL here. See `src/lib/warehouse.ts`.
