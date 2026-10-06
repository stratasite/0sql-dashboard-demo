'use client';

/**
 * Two columns: ask on the left, dashboard on the right. Below the large
 * breakpoint they become two tabs, because a dashboard you cannot reach is not
 * a dashboard.
 *
 * The selected user lives here because both halves need it — the chat sends it
 * with every question, the dashboard re-plans its tiles for it.
 */
import { useState } from 'react';
import { LayoutGrid, MessageSquare } from 'lucide-react';
import { Chat } from '@/components/Chat';
import { Dashboard } from '@/components/Dashboard';
import { Header } from '@/components/Header';
import { defaultUser } from '@/lib/users';

const PANES = [
  { value: 'ask', Icon: MessageSquare },
  { value: 'dashboard', Icon: LayoutGrid },
] as const;

export default function Page() {
  const [userId, setUserId] = useState(defaultUser.id);
  // Bumped whenever a tile is added or removed, which re-runs the dashboard.
  const [tilesVersion, setTilesVersion] = useState(0);
  const [pane, setPane] = useState<'ask' | 'dashboard'>('ask');

  return (
    <main className="flex h-dvh flex-col">
      <Header userId={userId} onUserChange={setUserId} />

      <nav className="flex gap-1 border-b border-border px-3 py-2 lg:hidden">
        {PANES.map(({ value, Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setPane(value)}
            aria-current={pane === value}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs ${
              pane === value ? 'bg-surface-2 text-foreground' : 'text-muted'
            }`}
          >
            <Icon aria-hidden className="size-3.5" />
            {value}
          </button>
        ))}
      </nav>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(22rem,34rem)_1fr] lg:divide-x lg:divide-border">
        <div className={`min-h-0 ${pane === 'ask' ? 'block' : 'hidden'} lg:block`}>
          <Chat userId={userId} onTilesChanged={() => setTilesVersion((v) => v + 1)} />
        </div>
        <div className={`min-h-0 ${pane === 'dashboard' ? 'block' : 'hidden'} lg:block`}>
          <Dashboard userId={userId} version={tilesVersion} />
        </div>
      </div>
    </main>
  );
}
