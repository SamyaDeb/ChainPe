import { useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Menu, X } from 'lucide-react'
import { Link } from '@/lib/router'
import type { NavItem } from './AppShell'

const iconBtn = 'inline-flex h-10 w-10 items-center justify-center rounded-full text-ink transition-colors duration-300 hover:bg-ink/5'

/**
 * The landing page's full-screen menu. A native dialog traps focus, closes on Escape
 * and hands focus back to the menu button.
 */
export function MobileNav({ path, items, footer }: { path: string; items: NavItem[]; footer: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const close = () => dialog.current?.close()

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        className={iconBtn}
        onClick={() => {
          dialog.current?.showModal()
          setOpen(true)
        }}
      >
        <Menu size={22} aria-hidden />
      </button>
      <dialog ref={dialog} aria-label="Menu" onClose={() => setOpen(false)} className="m-0 h-dvh max-h-none w-screen max-w-none bg-bg text-ink">
        {open ? (
          <div className="flex h-full flex-col overflow-y-auto px-6 py-5">
            <div className="flex items-center justify-between">
              <span className="font-brand text-xl font-semibold">ChainPe</span>
              <button type="button" aria-label="Close menu" className={iconBtn} onClick={close}>
                <X size={22} aria-hidden />
              </button>
            </div>
            <nav aria-label="Main" className="flex-1 py-8">
              <ul className="flex flex-col gap-3">
                {items.map((item) => {
                  const active = path === item.path
                  return (
                    <li key={item.path} className="rise">
                      <Link
                        to={item.path}
                        onClick={close}
                        aria-current={active ? 'page' : undefined}
                        className={clsx('font-display text-4xl tracking-tight transition-colors duration-300 sm:text-5xl', active ? 'text-ink' : 'text-muted hover:text-ink')}
                      >
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>
            <div className="border-t border-ink/10 pt-5">{footer}</div>
          </div>
        ) : null}
      </dialog>
    </>
  )
}
