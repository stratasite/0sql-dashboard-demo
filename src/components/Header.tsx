'use client';

/**
 * The header: who the query is for, and whether this clone is wired up.
 *
 * The user picker is not decoration. Every request carries that user's
 * security context, and the `Regional Cost Visibility` policy in
 * semantic/security.yml filters cost measures to the regions their groups
 * carry — in the SQL, before it runs. Switch user and watch the cost tiles
 * change without a line of application code deciding anything.
 */
import { useEffect, useState } from 'react';
import { users } from '@/lib/users';

interface Status {
  project: string;
  branch: string;
  apiBase: string;
  anthropicKey: boolean;
  warehouse: { ok: boolean; path: string };
  model: { ok: true; tables: number } | { ok: false; error: string };
}

export function Header({
  userId,
  onUserChange,
}: {
  userId: string;
  onUserChange: (id: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch('/api/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const user = users.find((u) => u.id === userId) ?? users[0];
  const problems = status
    ? [
        !status.anthropicKey && 'ANTHROPIC_API_KEY is not set',
        !status.warehouse.ok && `no warehouse at ${status.warehouse.path} — run npm run seed`,
        !status.model.ok && status.model.error,
      ].filter(Boolean as unknown as (v: unknown) => v is string)
    : [];

  return (
    <header className="border-b border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm">
            <span className="text-primary">ø</span>sql
          </span>
          <span className="text-sm text-muted">customer service analytics</span>
          {status && (
            <span className="hidden font-mono text-xs text-muted sm:inline">
              {status.project}/{status.branch}
              {status.model.ok ? ` · ${status.model.tables} tables` : ''}
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted">querying as</span>
          <select
            value={userId}
            onChange={(event) => onUserChange(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
          <span className="hidden text-muted md:inline">{user.blurb}</span>
        </label>
      </div>

      {problems.length > 0 && (
        <div className="border-t border-border bg-surface-2 px-4 py-2">
          <p className="font-mono text-xs text-primary">setup: {problems.join(' · ')}</p>
          <p className="mt-1 text-xs text-muted">
            See the README: copy <code className="font-mono">.env.example</code> to{' '}
            <code className="font-mono">.env.local</code>, deploy the model with{' '}
            <code className="font-mono">zsql deploy --dir semantic</code>, then{' '}
            <code className="font-mono">npm run seed</code>.
          </p>
        </div>
      )}
    </header>
  );
}
