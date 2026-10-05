<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# This repo

A demo: a chat-driven analytics dashboard on the [0sql](https://0sql.io)
semantic layer. Read `README.md` first, then `src/lib/agent.ts`.

- `semantic/` is a 0sql project, deployed with `zsql deploy --project semantic`.
  Field *names* in `src/lib/tiles.ts` and the system prompt must match what the
  model deploys; check with `zsql fields --project semantic "<term>"`.
- The agent writes query specs, never SQL. If you are tempted to add a tool that
  takes SQL, the demo has lost its point.
- The security context is attached in the route handler, never by the model and
  never from the browser.
- `npm run seed` rebuilds the DuckDB warehouse from the Parquet files and
  re-anchors the dates on today.
