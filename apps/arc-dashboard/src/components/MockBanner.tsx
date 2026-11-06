import { FlaskConical } from 'lucide-react'

/** Shown for as long as the app runs on sample data. It cannot be dismissed. */
export function MockBanner() {
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warn-soft px-4 py-1.5 text-center font-mono text-xs text-warn">
      <FlaskConical size={14} aria-hidden />
      Sample data, not live
    </div>
  )
}
