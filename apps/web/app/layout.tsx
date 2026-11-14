import type { Metadata } from 'next';
import './globals.css';
import './heist.css';

export const metadata: Metadata = {
  title: 'HEIST — Rob the agent. Prove the defense.',
  description: 'A red-team arena and auditor for AI agents that hold money. Deterministic breach checks over an owned synthetic payment sandbox; every attempt hashed and replayable.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
