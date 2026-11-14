import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import type { Payment, PaymentFilters, Verification } from '@/api/schema'
import { useAuth } from '@/auth/AuthContext'
import { LiveStatus } from '@/components/LiveStatus'
import { AddressView, TxLink } from '@/components/ui/Address'
import { explainVerification, Pill, SelfPayBadge, VerificationBadge } from '@/components/ui/Badges'
import { Note, PageHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Button, Field, inputCls } from '@/components/ui/forms'
import { EmptyState, ErrorState, ResourceView } from '@/components/ui/States'
import { useResource } from '@/hooks/useResource'
import { formatUsdc } from '@/lib/money'
import { formatDateTime } from '@/lib/time'

/** The indexer records a payment straight from its USDC transfer when no proxy reported it. See chainpe-cloud's workers/payments.ts. */
const fromChain = (p: Payment): boolean => p.id.startsWith('onchain_')

function Settlement({ p }: { p: Payment }) {
  return p.txHash ? <TxLink hash={p.txHash} label="Payment transaction" /> : <span className="text-muted">No transaction reported</span>
}

const columns: Array<Column<Payment>> = [
  { header: 'Time', cell: (p) => <span className="tabular-nums">{formatDateTime(p.effectiveTs)}</span> },
  {
    header: 'Route',
    cell: (p) => (
      <span className="flex flex-col gap-0.5">
        <span className="break-all font-mono text-xs">
          {p.method} {p.route}
        </span>
        <span className="text-xs text-muted">{fromChain(p) ? 'Paid at the listed price' : `Call ${p.status}${p.error ? `: ${p.error}` : ''}`}</span>
      </span>
    ),
  },
  { header: 'Source', cell: (p) => <Pill tone="accent">{fromChain(p) ? 'On-chain' : 'Proxy'}</Pill> },
  { header: 'Amount', cell: (p) => <span className="font-display text-2xl tracking-tight">{formatUsdc(p.amountAtomic)}</span> },
  { header: 'Payer', cell: (p) => (p.payer === 'unknown' ? <span className="text-muted">unknown</span> : <AddressView address={p.payer} />) },
  {
    header: 'Verification',
    cell: (p) => (
      <span className="flex flex-col items-end gap-1 sm:items-start">
        <span className="flex flex-wrap gap-1">
          <VerificationBadge value={p.verification} />
          {p.selfPay ? <SelfPayBadge /> : null}
        </span>
        <span className="max-w-xs text-xs text-muted">{explainVerification(p.verification, p.verificationReason)}</span>
      </span>
    ),
  },
  { header: 'Settlement', cell: (p) => <Settlement p={p} /> },
]

function saveBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'chainpe-payments.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface More {
  key: string
  rows: Payment[]
  cursor: string | null
}

export function Payments() {
  const { api, handleError } = useAuth()
  const [verification, setVerification] = useState<'' | Verification>('')
  const [routeDraft, setRouteDraft] = useState('')
  const [route, setRoute] = useState('')
  const [more, setMore] = useState<More | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<unknown>(null)
  const [csv, setCsv] = useState<'idle' | 'working' | { error: unknown }>('idle')

  useEffect(() => {
    const id = window.setTimeout(() => setRoute(routeDraft.trim()), 400)
    return () => window.clearTimeout(id)
  }, [routeDraft])

  const filters: PaymentFilters = { verification: verification || undefined, route: route || undefined }
  const filterKey = `${verification}|${route}`
  const first = useResource(`payments-${filterKey}`, () => api.payments({ limit: 50, ...filters }), { pollMs: 3000 })

  const extra = more && more.key === filterKey ? more : null
  const cursor = extra ? extra.cursor : (first.data?.nextCursor ?? null)

  const loadMore = async () => {
    if (!cursor) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await api.payments({ limit: 50, cursor, ...filters })
      setMore((prev) => ({
        key: filterKey,
        rows: [...(prev && prev.key === filterKey ? prev.rows : []), ...page.payments],
        cursor: page.nextCursor,
      }))
    } catch (e) {
      if (!handleError(e)) setMoreError(e)
    } finally {
      setLoadingMore(false)
    }
  }

  const exportCsv = async () => {
    setCsv('working')
    try {
      saveBlob(await api.paymentsCsv(filters))
      setCsv('idle')
    } catch (e) {
      if (handleError(e)) return
      setCsv({ error: e })
    }
  }

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Your full payment history. Every row is backed by a USDC transfer on Avalanche or is marked unverified."
        right={<LiveStatus updatedAt={first.updatedAt} failing={first.error !== null && first.data !== null} />}
      />

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_auto] lg:items-start">
        <Field label="Verification" htmlFor="f-verification">
          <select id="f-verification" className={inputCls} value={verification} onChange={(e) => setVerification(e.target.value as '' | Verification)}>
            <option value="">All</option>
            <option value="verified">Verified</option>
            <option value="unverified">Unverified</option>
            <option value="failed">Failed</option>
          </select>
        </Field>
        <Field label="Route" htmlFor="f-route" hint="A proxy route such as /weather, or a service name for on-chain rows">
          <input id="f-route" className={inputCls} value={routeDraft} onChange={(e) => setRouteDraft(e.target.value)} placeholder="All routes" autoComplete="off" />
        </Field>
        <Button className="lg:mt-7" onClick={() => void exportCsv()} disabled={csv === 'working'}>
          {csv === 'working' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Download size={16} aria-hidden />}
          Export CSV
        </Button>
      </div>

      {typeof csv === 'object' ? (
        <div className="mb-4">
          <ErrorState error={csv.error} onRetry={() => void exportCsv()} />
        </div>
      ) : null}

      <ResourceView
        resource={first}
        isEmpty={(d) => d.payments.length === 0}
        empty={
          filterKey === '|' ? (
            <EmptyState title="No payments yet" body="Paid calls appear here a few seconds after their USDC transfer lands on Avalanche." command="chainpe start" />
          ) : (
            <EmptyState title="No payments match these filters" body="Clear a filter to see more." />
          )
        }
      >
        {(d) => {
          const seen = new Set(d.payments.map((p) => p.id))
          const rows = [...d.payments, ...(extra?.rows ?? []).filter((p) => !seen.has(p.id))]
          return (
            <div className="flex flex-col gap-3">
              <DataTable caption="Payments, newest first" columns={columns} rows={rows} rowKey={(p) => p.id} />
              {moreError ? <ErrorState error={moreError} onRetry={() => void loadMore()} /> : null}
              {cursor ? (
                <Button className="self-center" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                  Load more
                </Button>
              ) : null}
              <Note>Revenue counts verified rows only. Self-pay rows are shown but never counted.</Note>
            </div>
          )
        }}
      </ResourceView>
    </>
  )
}
