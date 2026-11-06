import { FlaskConical } from 'lucide-react'

/** Shown for as long as the app runs on sample data. It cannot be dismissed. */
export function MockBanner() {
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-warn bg-warn-soft px-4 py-2 text-center text-sm font-medium text-warn">
      <FlaskConical size={16} aria-hidden />
      Sample data, not live
    </div>
  )
}
