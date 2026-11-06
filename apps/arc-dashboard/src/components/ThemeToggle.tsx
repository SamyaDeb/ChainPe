import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink/70 transition-colors duration-300 hover:bg-ink/5 hover:text-ink"
    >
      {theme === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  )
}
