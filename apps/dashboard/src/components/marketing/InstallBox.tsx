'use client'

import { useState } from 'react'

type Tab = 'npm' | 'yarn' | 'pnpm'

const commands: Record<Tab, string> = {
  npm: 'npm install @chainpe/agent',
  yarn: 'yarn add @chainpe/agent',
  pnpm: 'pnpm add @chainpe/agent',
}

export default function InstallBox() {
  const [tab, setTab] = useState<Tab>('npm')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commands[tab])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  return (
    <div className="hero-install">
      <div className="install-tabs">
        {(['npm', 'yarn', 'pnpm'] as Tab[]).map(t => (
          <button
            key={t}
            className={`install-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="install-code">
        <code>{commands[tab]}</code>
        <button className="copy-btn" onClick={copy} aria-label="Copy to clipboard">
          {copied ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
