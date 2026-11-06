import type { ReactNode } from 'react'
import clsx from 'clsx'
import { CreditCard, HeartPulse, LayoutDashboard, LogOut, Receipt, Server, Settings, Star, Users, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Link, usePath } from '@/lib/router'
import { MockBanner } from './MockBanner'
import { ThemeToggle } from './ThemeToggle'
import { AddressView } from './ui/Address'
import { PlanBadge, Pill } from './ui/Badges'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
}

export const NAV: NavItem[] = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/services', label: 'Services', icon: Server },
  { path: '/payments', label: 'Payments', icon: Receipt },
  { path: '/buyers', label: 'Buyers', icon: Users },
  { path: '/reputation', label: 'Reputation', icon: Star },
  { path: '/health', label: 'Listing health', icon: HeartPulse },
  { path: '/billing', label: 'Billing', icon: CreditCard },
  { path: '/settings', label: 'Settings', icon: Settings },
]

function Brand() {
  return (
    <span className="flex items-center gap-2 text-base font-semibold text-ink">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden focusable="false">
        <rect width="20" height="20" rx="5" className="fill-accent" />
        <path d="M6 10.5 9 13.5 14.5 6.5" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-fg" />
      </svg>
      ChainPe
    </span>
  )
}

function PlanAndAddress({ address, plan }: { address: string; plan: 'free' | 'pro' | null }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {plan ? <PlanBadge plan={plan} /> : <Pill>Plan loading</Pill>}
      {address ? <AddressView address={address} /> : null}
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, me, mock, signOut } = useAuth()
  const path = usePath()
  const address = session?.address ?? ''

  return (
    <div className="flex min-h-dvh flex-col">
      {mock ? <MockBanner /> : null}
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between border-r border-line bg-surface p-4 sm:flex">
          <div className="flex flex-col gap-6">
            <Brand />
            <nav aria-label="Main" className="flex flex-col gap-1">
              {NAV.map((item) => {
                const active = path === item.path
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={clsx(
                      'flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium',
                      active ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-subtle',
                    )}
                  >
                    <item.icon size={16} aria-hidden /> {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>
          <div className="flex flex-col gap-3">
            <PlanAndAddress address={address} plan={me?.plan ?? null} />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => void signOut()}
                className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-ink"
              >
                <LogOut size={16} aria-hidden /> Sign out
              </button>
              <ThemeToggle />
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2 sm:hidden">
            <div className="flex min-w-0 flex-col gap-1">
              <Brand />
              <PlanAndAddress address={address} plan={me?.plan ?? null} />
            </div>
            <div className="flex shrink-0 items-center">
              <ThemeToggle />
              <button
                type="button"
                onClick={() => void signOut()}
                aria-label="Sign out"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
              >
                <LogOut size={18} aria-hidden />
              </button>
            </div>
          </div>
          <main className="mx-auto w-full max-w-5xl min-w-0 flex-1 p-4 pb-28 sm:p-6 sm:pb-6">{children}</main>
        </div>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t border-line bg-surface sm:hidden">
        {NAV.map((item) => {
          const active = path === item.path
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex min-h-14 min-w-20 flex-1 shrink-0 flex-col items-center justify-center gap-0.5 px-2 text-xs font-medium',
                active ? 'text-accent' : 'text-muted',
              )}
            >
              <item.icon size={20} aria-hidden />
              <span className="whitespace-nowrap">{item.label === 'Listing health' ? 'Health' : item.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
