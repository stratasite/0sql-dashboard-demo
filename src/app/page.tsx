'use client';

/**
 * Two columns: ask on the left, dashboard on the right.
 *
 * The selected user lives here because both halves need it — the chat sends it
 * with every question, the dashboard re-plans its tiles for it.
 */
import { useState } from 'react';
import { Chat } from '@/components/Chat';
import { Dashboard } from '@/components/Dashboard';
import { Header } from '@/components/Header';
import { defaultUser } from '@/lib/users';

export default function Page() {
  const [userId, setUserId] = useState(defaultUser.id);
  // Bumped whenever a tile is added or removed, which re-runs the dashboard.
  const [tilesVersion, setTilesVersion] = useState(0);

  return (
    <main className="flex h-dvh flex-col">
      <Header userId={userId} onUserChange={setUserId} />
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(22rem,34rem)_1fr] lg:divide-x lg:divide-border">
        <Chat userId={userId} onTilesChanged={() => setTilesVersion((v) => v + 1)} />
        <div className="hidden min-h-0 lg:block">
          <Dashboard userId={userId} version={tilesVersion} />
        </div>
      </div>
    </main>
  );
}
