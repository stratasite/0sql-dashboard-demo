import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '0sql customer service analytics',
  description:
    'A chat-driven analytics dashboard: Claude writes 0sql query specs, 0sql plans the SQL, the app runs it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  );
}
