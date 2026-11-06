import type { ReactNode } from 'react'
import { AlertTriangle, CircleDashed, Dot } from 'lucide-react'
import type { AgentIdStatus, ServiceItem } from '@/api/schema'
import { useAuth } from '@/auth/AuthContext'
import { useMe } from '@/auth/useMe'
import { AddressView } from '@/components/ui/Address'
import { Pill } from '@/components/ui/Badges'
import { Card, PageHeader } from '@/components/ui/Card'
import { CopyButton } from '@/components/ui/Copy'
import { EmptyState, LockedCard, ResourceView } from '@/components/ui/States'
import { useNow } from '@/hooks/useNow'
import { useResource } from '@/hooks/useResource'
import { formatUsdc, parseAtomic } from '@/lib/money'
import { ago, ONLINE_WINDOW_MS } from '@/lib/time'

function Heartbeat({ at, now }: { at: string | null; now: number }) {
  if (at === null) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted">
        <CircleDashed size={14} aria-hidden /> Never reported
      </span>
    )
  }
  const t = Date.parse(at)
  const online = !Number.isNaN(t) && now - t < ONLINE_WINDOW_MS
  return online ? (
    <span className="inline-flex items-center gap-1 text-sm text-ok">
      <Dot size={20} strokeWidth={8} className="-mx-1" aria-hidden /> Online, {ago(at, now)}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm text-warn">
      <AlertTriangle size={14} aria-hidden /> Stale, last seen {ago(at, now)}
    </span>
  )
}

function agentText(id: string | null, status: AgentIdStatus): ReactNode {
  if (status === 'owned' && id) return `#${id}`
  if (status === 'none') {
    return (
      <>
        None. Run <code className="font-mono">chainpe identity</code>
      </>
    )
  }
  if (status === 'not_owner') return 'This wallet no longer owns the agent'
  return 'Ownership could not be checked'
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-xs text-muted">{label}</dt>
      <dd className="mt-1 break-words text-sm text-ink">{children}</dd>
    </div>
  )
}

function ServiceCard({ s, now, agent }: { s: ServiceItem; now: number; agent: ReactNode }) {
  const price = parseAtomic(s.priceAtomic) !== null ? formatUsdc(s.priceAtomic) : `${s.price} (could not be read as USDC)`
  return (
    <Card as="article">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-words font-display text-4xl tracking-tight text-ink lg:text-5xl">{s.name}</h2>
          <p className="mt-2 max-w-prose break-words text-muted">{s.description}</p>
        </div>
        <Pill tone={s.active ? 'ok' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Pill>
      </div>

      <div className="mt-6 flex items-center justify-between gap-2 border border-ink/10 bg-subtle py-1.5 pl-4 pr-1.5">
        <code className="min-w-0 break-all font-mono text-sm">{s.endpoint}</code>
        <CopyButton value={s.endpoint} label="endpoint" />
      </div>

      <dl className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Row label="Price per call">{price}</Row>
        <Row label="Accepts">
          <span className="flex flex-wrap gap-1">
            {s.acceptsExact ? <Pill tone="accent">Exact</Pill> : null}
            {s.acceptsGateway ? <Pill tone="accent">Gateway</Pill> : null}
            {!s.acceptsExact && !s.acceptsGateway ? <span className="text-muted">No rail</span> : null}
          </span>
        </Row>
        <Row label="Proxy status">
          <Heartbeat at={s.lastHeartbeatAt} now={now} />
          {s.version ? <span className="block text-xs text-muted">Version {s.version}{s.rails ? `, rails ${s.rails.join(' + ') || 'none'}` : ''}</span> : null}
        </Row>
        <Row label="Doctor">
          {s.doctor ? (
            <span className="inline-flex items-center gap-2">
              <span className="font-semibold tabular-nums">
                {s.doctor.passed}/{s.doctor.total}
              </span>
              <Pill tone={s.doctor.ok ? 'ok' : 'bad'}>{s.doctor.ok ? 'OK' : 'Needs attention'}</Pill>
            </span>
          ) : (
            <span className="text-muted">No report yet. Run <code className="font-mono">chainpe doctor</code></span>
          )}
        </Row>
        <Row label="Agent ID">{agent}</Row>
        <Row label="Pays out to">
          <AddressView address={s.payTo} />
        </Row>
        {s.tags ? <Row label="Tags">{s.tags}</Row> : null}
      </dl>
    </Card>
  )
}

export function Services() {
  const me = useMe()
  const { api } = useAuth()
  const now = useNow(30_000)
  const services = useResource('services', () => api.services())
  const agent = agentText(me.agentId, me.agentIdStatus)

  return (
    <>
      <PageHeader
        title="Services"
        subtitle={me.plan === 'free' ? 'Free shows your oldest active service.' : 'All of your services, including inactive ones.'}
      />
      <ResourceView
        resource={services}
        isEmpty={(d) => d.services.length === 0}
        empty={<EmptyState title="No services listed" body="List a service and start your proxy. It appears here after its first heartbeat." command="chainpe start" />}
      >
        {(d) => (
          <div className="flex flex-col gap-6">
            {d.services.map((s) => (
              <ServiceCard key={s.key} s={s} now={now} agent={agent} />
            ))}
            {d.truncated ? <LockedCard feature="More services" description="Free shows one service. Pro shows all of them, including inactive ones." /> : null}
          </div>
        )}
      </ResourceView>
    </>
  )
}
