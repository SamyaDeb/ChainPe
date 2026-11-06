import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { CreatedKey, KeyListItem } from '@/api/schema'
import { useAuth } from '@/auth/AuthContext'
import { Pill } from '@/components/ui/Badges'
import { Card, SectionTitle } from '@/components/ui/Card'
import { CopyButton } from '@/components/ui/Copy'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Button, Field, inputCls } from '@/components/ui/forms'
import { EmptyState, ErrorState, ResourceView } from '@/components/ui/States'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/lib/time'

/** A newly created key. It lives in this component's state only: it is never stored or logged. */
function ShownOnce({ created, onDone }: { created: CreatedKey; onDone: () => void }) {
  return (
    <div role="alert" className="border border-warn bg-warn-soft p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-warn">
        <AlertTriangle size={16} aria-hidden /> Copy this key now. It is shown once and cannot be retrieved later.
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 border border-ink/10 bg-bg py-1.5 pl-4 pr-1.5">
        <code className="min-w-0 break-all font-mono text-sm text-ink">{created.key}</code>
        <CopyButton value={created.key} label="ingest key" />
      </div>
      <Button className="mt-3" onClick={onDone}>
        I have saved it
      </Button>
    </div>
  )
}

export function Keys() {
  const { api, handleError } = useAuth()
  const keys = useResource('keys', () => api.keys())
  const [name, setName] = useState('')
  const [created, setCreated] = useState<CreatedKey | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)

  const create = async () => {
    setBusy('create')
    setError(null)
    try {
      setCreated(await api.createKey(name.trim() || undefined))
      setName('')
      keys.reload()
    } catch (e) {
      if (!handleError(e)) setError(e)
    } finally {
      setBusy(null)
    }
  }

  const revoke = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      await api.revokeKey(id)
      setConfirming(null)
      keys.reload()
    } catch (e) {
      if (!handleError(e)) setError(e)
    } finally {
      setBusy(null)
    }
  }

  const columns: Array<Column<KeyListItem>> = [
    { header: 'Key', cell: (k) => <code className="font-mono text-sm">{k.prefix}...</code> },
    { header: 'Name', cell: (k) => k.name ?? <span className="text-muted">Unnamed</span> },
    { header: 'Created', cell: (k) => formatDateTime(k.createdAt) },
    { header: 'Last used', cell: (k) => (k.lastUsedAt ? formatDateTime(k.lastUsedAt) : <span className="text-muted">Never</span>) },
    {
      header: 'Status',
      cell: (k) =>
        k.revokedAt ? (
          <Pill tone="neutral">Revoked {formatDateTime(k.revokedAt)}</Pill>
        ) : confirming === k.id ? (
          <span className="flex flex-wrap justify-end gap-2 sm:justify-start">
            <Button variant="danger" disabled={busy === k.id} onClick={() => void revoke(k.id)}>
              {busy === k.id ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Confirm revoke
            </Button>
            <Button onClick={() => setConfirming(null)}>Cancel</Button>
          </span>
        ) : (
          <span className="flex flex-wrap items-center justify-end gap-2 sm:justify-start">
            <Pill tone="ok">Active</Pill>
            <Button onClick={() => setConfirming(k.id)} aria-label={`Revoke key ${k.prefix}`}>
              Revoke
            </Button>
          </span>
        ),
    },
  ]

  return (
    <Card>
      <SectionTitle>Ingest keys</SectionTitle>
      <p className="mb-3 max-w-prose text-sm text-muted">
        Your proxy uses an ingest key to send payment events and heartbeats. Revoking a key stops that proxy from reporting.
      </p>
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <div className="min-w-48 flex-1">
          <Field label="Key name (optional)" htmlFor="key-name">
            <input id="key-name" className={inputCls} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="railway-demo" autoComplete="off" />
          </Field>
        </div>
        <Button variant="primary" type="submit" disabled={busy === 'create'}>
          {busy === 'create' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          Create key
        </Button>
      </form>
      {created ? (
        <div className="mb-3">
          <ShownOnce created={created} onDone={() => setCreated(null)} />
        </div>
      ) : null}
      {error ? (
        <div className="mb-3">
          <ErrorState error={error} />
        </div>
      ) : null}
      <ResourceView
        resource={keys}
        isEmpty={(d) => d.keys.length === 0}
        empty={<EmptyState title="No ingest keys yet" body="Create one, then connect your proxy." command="chainpe login" />}
        skeletonRows={2}
      >
        {(d) => <DataTable caption="Ingest keys" columns={columns} rows={d.keys} rowKey={(k) => k.id} />}
      </ResourceView>
    </Card>
  )
}
