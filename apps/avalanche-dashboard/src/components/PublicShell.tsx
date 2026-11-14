import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { SAMPLE_PROVIDER, USE_MOCK } from '@/lib/env'
import { Link } from '@/lib/router'
import { NetworkPill, ShellFrame, type NavItem } from './AppShell'

/** The public pages: no session, no AuthProvider. The dashboard link leads to sign-in, or straight in if signed in. */
export const PUBLIC_NAV: NavItem[] = [
  { path: '/explore', label: 'Explore' },
  // Only when this build names a sample provider (VITE_SAMPLE_PROVIDER).
  ...(SAMPLE_PROVIDER ? [{ path: '/sample', label: 'Sample provider' }] : []),
]

/** The menu lists the dashboard too: the header link is hidden on small screens. */
const MENU_NAV: NavItem[] = [...PUBLIC_NAV, { path: '/', label: 'Provider dashboard' }]

function DashboardLink() {
  return (
    <Link
      to="/"
      className="group inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full border border-ink/20 px-4 text-sm text-ink transition-colors duration-300 hover:border-ink hover:bg-ink/5"
    >
      Provider dashboard
      <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
    </Link>
  )
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <ShellFrame
      nav={PUBLIC_NAV}
      menuNav={MENU_NAV}
      home="/explore"
      mock={USE_MOCK}
      right={
        <div className="flex items-center gap-3">
          <NetworkPill />
          <DashboardLink />
        </div>
      }
      compactRight={<NetworkPill />}
      menuFooter={<NetworkPill />}
    >
      {children}
    </ShellFrame>
  )
}
