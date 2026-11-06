import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { MoreHorizontal } from 'lucide-react'
import { Link } from '@/lib/router'
import type { NavItem } from './AppShell'

const itemCls = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium'

/**
 * Five bottom items for narrow screens: four pages and a More panel for the rest.
 * The panel is closed by Escape, by navigating, and by tapping outside it.
 */
export function MobileNav({ path, main, more }: { path: string; main: NavItem[]; more: NavItem[] }) {
  // The panel is open only for the page it was opened on, so navigating closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === path
  const button = useRef<HTMLButtonElement>(null)
  const activeMore = more.find((m) => m.path === path)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpenAt(null)
      button.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 sm:hidden">
      {open ? <div aria-hidden className="fixed inset-0 -z-10" onClick={() => setOpenAt(null)} /> : null}
      <nav aria-label="Main" className="flex border-t border-line bg-surface">
        {main.map((item) => {
          const active = path === item.path
          return (
            <Link key={item.path} to={item.path} aria-current={active ? 'page' : undefined} className={clsx(itemCls, active ? 'text-accent' : 'text-muted')}>
              <item.icon size={20} aria-hidden />
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          )
        })}
        <button
          ref={button}
          type="button"
          aria-expanded={open}
          aria-controls="more-panel"
          onClick={() => setOpenAt(open ? null : path)}
          className={clsx(itemCls, activeMore || open ? 'text-accent' : 'text-muted')}
        >
          <MoreHorizontal size={20} aria-hidden />
          <span className="whitespace-nowrap">More</span>
          {activeMore ? <span className="sr-only">, current page is {activeMore.label}</span> : null}
        </button>
      </nav>
      {open ? (
        <ul id="more-panel" aria-label="More pages" className="absolute bottom-full right-2 mb-2 w-56 rounded-lg border border-line bg-surface p-1 shadow-lg">
          {more.map((item) => {
            const active = path === item.path
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-medium',
                    active ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-subtle',
                  )}
                >
                  <item.icon size={18} aria-hidden /> {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
