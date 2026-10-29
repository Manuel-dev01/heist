import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HEIST — The local test range',
  description: 'An isolated, scripted practice range for examining wallet-agent decisions, policy enforcement, and verifiable attempt records.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}