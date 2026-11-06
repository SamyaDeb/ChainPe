export function LiveStatus({ updatedAt, failing }: { updatedAt: number | null; failing: boolean }) {
  return (
    <p className="flex items-center gap-2 text-xs text-muted" role="status">
      <span aria-hidden className={`h-2 w-2 rounded-full ${failing ? 'bg-warn' : 'animate-pulse bg-ok'}`} />
      {failing ? 'Live updates paused, retrying' : updatedAt ? `Live, updated ${new Date(updatedAt).toLocaleTimeString()}` : 'Connecting'}
    </p>
  )
}
