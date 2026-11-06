import { useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Link, usePath } from '@/lib/router'
import { MobileNav } from './MobileNav'
import { MockBanner } from './MockBanner'
import { StudioMark } from './StudioMark'
import { ThemeToggle } from './ThemeToggle'
import { AddressView } from './ui/Address'
import { PlanBadge, Pill } from './ui/Badges'

export interface NavItem {
  path: string
  label: string
}

export const NAV: NavItem[] = [
  { path: '/', label: 'Overview' },
  { path: '/services', label: 'Services' },
  { path: '/payments', label: 'Payments' },
  { path: '/buyers', label: 'Buyers' },
  { path: '/reputation', label: 'Reputation' },
  { path: '/health', label: 'Listing health' },
  { path: '/billing', label: 'Billing' },
  { path: '/settings', label: 'Settings' },
]

function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return scrolled
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
  const scrolled = useScrolled()
  const address = session?.address ?? ''
  const plan = me?.plan ?? null

  const signOutButton = (
    <button
      type="button"
      onClick={() => void signOut()}
      aria-label="Sign out"
      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink/70 transition-colors duration-300 hover:bg-ink/5 hover:text-ink"
    >
      <LogOut size={18} aria-hidden />
    </button>
  )

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-fg"
      >
        Skip to content
      </a>
      {mock ? <MockBanner /> : null}

      {/* The outer height never changes, so the bar can shrink into a pill without moving the page. */}
      <header className="sticky top-0 z-40 h-20">
        <div className={clsx('transition-all duration-500', scrolled ? 'px-4 pt-4' : 'px-0 pt-0')}>
          <div
            className={clsx(
              'mx-auto flex items-center justify-between gap-6 border px-6 transition-all duration-500 lg:px-8',
              scrolled ? 'h-14 max-w-[1240px] rounded-2xl border-ink/10 bg-bg/80 shadow-lg backdrop-blur-xl' : 'h-20 max-w-[1400px] border-transparent lg:px-12',
            )}
          >
            <Link to="/" className="font-brand text-[22px] font-semibold text-ink">
              ChainPe
            </Link>
            <nav aria-label="Main" className="hidden items-center gap-6 xl:flex">
              {NAV.map((item) => {
                const active = path === item.path
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={clsx('group relative whitespace-nowrap text-sm transition-colors duration-300 hover:text-ink', active ? 'text-ink' : 'text-ink/70')}
                  >
                    {item.label}
                    <span aria-hidden className={clsx('absolute -bottom-1 left-0 h-px bg-ink transition-all duration-300 group-hover:w-full', active ? 'w-full' : 'w-0')} />
                  </Link>
                )
              })}
            </nav>
            <div className="flex shrink-0 items-center gap-1">
              <div className="mr-2 hidden xl:block">
                <PlanAndAddress address={address} plan={plan} />
              </div>
              <div className="mr-1 xl:hidden">{plan ? <PlanBadge plan={plan} /> : null}</div>
              <ThemeToggle />
              <div className="hidden xl:block">{signOutButton}</div>
              <div className="xl:hidden">
                <MobileNav
                  path={path}
                  items={NAV}
                  footer={
                    <div className="flex items-center justify-between gap-2">
                      <PlanAndAddress address={address} plan={plan} />
                      {signOutButton}
                    </div>
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-6 pb-16 pt-10 focus-visible:outline-none lg:px-12 lg:pt-16">
        {children}
      </main>

      <footer className="border-t border-ink/10">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-6 lg:px-12">
          <p className="flex items-center gap-2 text-sm text-muted">
            <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />
            ChainPe on Arc testnet
          </p>
          <StudioMark />
        </div>
      </footer>
    </div>
  )
}
