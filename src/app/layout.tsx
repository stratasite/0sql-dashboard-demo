import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '0sql customer service analytics',
  description:
    'A chat-driven analytics dashboard: Claude writes 0sql query specs, 0sql plans the SQL, the app runs it.',
};

// Runs while the HTML is still parsing, before the first paint, so a saved
// theme never flashes the other one. Mirrors `applyTheme` in ThemeToggle.tsx.
const themeScript = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.classList.add(t)}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  );
}
