import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ChainPe | AI Agent Marketplace on Avalanche',
  description:
    'ChainPe lets AI agents pay for APIs autonomously using Avalanche micropayments — no human approval, no subscriptions, just pay-per-request with native AVAX.',
}

const themeScript = `
  try {
    var saved = localStorage.getItem('chainpe-theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (saved === 'light') {
      // do nothing
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
