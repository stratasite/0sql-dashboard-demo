# The warehouse

5,000 synthetic customer service contacts across nine call centers, as Parquet.
`npm run seed` loads them into `cs_warehouse.duckdb` and shifts every date so
the most recent contact lands on today — relative filters like `28d` and `3m`
then answer with rows whenever the repo is cloned.

| File | Rows | Grain |
|---|---|---|
| `data/cs_contact_f.parquet` | 5,000 | one customer service contact |
| `data/cs_call_center_d.parquet` | 9 | one call center site |

The data is generated. Nothing in it comes from a real customer, agent or
account.

0sql never reads any of this: it plans SQL from `semantic/`, and the app runs
that SQL here. See `src/lib/warehouse.ts`.
