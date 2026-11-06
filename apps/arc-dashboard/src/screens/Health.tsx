import type { Health as HealthData, HealthEntry } from '@/api/schema'
import { useAuth } from '@/auth/AuthContext'
import { CheckBadge, Pill } from '@/components/ui/Badges'
import { Card, PageHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState, LockedCard, ResourceView } from '@/components/ui/States'
import { useResource } from '@/hooks/useResource'
import { parseDoctor, type DoctorReport } from '@/lib/doctor'
import { formatDateTime } from '@/lib/time'

function Checks({ report }: { report: DoctorReport }) {
  if (report.checks.length === 0) {
    return <p className="text-sm text-muted">This report has no check details, only the score.</p>
  }
  return (
    <ul className="flex flex-col divide-y divide-line">
      {report.checks.map((c, i) => (
        <li key={`${c.id ?? i}-${c.name}`} className="flex flex-col gap-1 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{c.name}</span>
            <CheckBadge status={c.status} />
            {c.required ? <Pill>Required</Pill> : null}
          </div>
          {c.detail ? <p className="break-words text-sm text-muted">{c.detail}</p> : null}
          {c.diff.length > 0 ? (
            <ul className="list-inside list-disc break-all font-mono text-xs text-muted">
              {c.diff.map((line, j) => (
                <li key={j}>{line}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function Latest({ entry, report }: { entry: HealthEntry; report: DoctorReport }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted">
            Last <code className="font-mono">chainpe doctor</code> result
          </p>
          <p className="mt-1 text-4xl font-semibold tabular-nums text-ink">
            {report.passed}/{report.total}
            <span className="ml-2 text-base font-normal text-muted">checks passed</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={report.ok ? 'ok' : 'bad'}>{report.ok ? 'OK: no required check failed' : 'Not OK: a required check failed'}</Pill>
          <Pill tone={report.allGreen ? 'ok' : 'warn'}>{report.allGreen ? 'All green' : 'Not all green'}</Pill>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        Reported {formatDateTime(report.generatedAt ?? entry.ts)} by proxy {entry.version}
        {report.service ? `, service ${report.service}` : ''}
      </p>
      <div className="mt-3">
        <Checks report={report} />
      </div>
    </Card>
  )
}

function History({ entries }: { entries: HealthEntry[] }) {
  const columns: Array<Column<HealthEntry>> = [
    { header: 'Time', cell: (e) => formatDateTime(e.ts) },
    { header: 'Version', cell: (e) => e.version },
    {
      header: 'Result',
      cell: (e) => {
        const r = parseDoctor(e.doctor)
        if (!r) return <span className="text-muted">Heartbeat only, no report</span>
        return (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tabular-nums">
              {r.passed}/{r.total}
            </span>
            <Pill tone={r.ok ? 'ok' : 'bad'}>{r.ok ? 'OK' : 'Not OK'}</Pill>
          </span>
        )
      },
    },
    {
      header: 'Checks',
      cell: (e) => {
        const r = parseDoctor(e.doctor)
        if (!r || r.checks.length === 0) return <span className="text-muted">{'\u2014'}</span>
        return (
          <details>
            <summary className="cursor-pointer text-accent">Show {r.checks.length} checks</summary>
            <div className="mt-2 text-left">
              <Checks report={r} />
            </div>
          </details>
        )
      },
    },
  ]
  return <DataTable caption="Doctor history" columns={columns} rows={entries} rowKey={(e) => `${e.serviceKey}-${e.ts}`} />
}

function Body({ d }: { d: HealthData }) {
  const withReport = d.history.find((e) => parseDoctor(e.doctor) !== null)
  const report = withReport ? parseDoctor(withReport.doctor) : null
  const hasDoctorValue = d.history.some((e) => e.doctor !== null)
  return (
    <div className="flex flex-col gap-4">
      {withReport && report ? (
        <Latest entry={withReport} report={report} />
      ) : (
        <EmptyState
          title={hasDoctorValue ? 'The doctor report was not recognised' : 'No doctor report yet'}
          body="Doctor checks your listing and sends the result with your next heartbeat."
          command="chainpe doctor"
        />
      )}
      {d.latestOnly ? (
        <LockedCard feature="Check history" description="Pro keeps the last 100 doctor reports so you can see when a check started failing." />
      ) : d.history.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">History</h2>
          <History entries={d.history} />
        </section>
      ) : null}
    </div>
  )
}

export function Health() {
  const { api } = useAuth()
  const health = useResource('health', () => api.health())
  return (
    <>
      <PageHeader title="Listing health" subtitle="What chainpe doctor last reported for your listing." />
      <ResourceView
        resource={health}
        isEmpty={(d) => d.history.length === 0}
        empty={<EmptyState title="No doctor report yet" body="Run doctor, then start your proxy so the result is sent here." command="chainpe doctor" />}
      >
        {(d) => <Body d={d} />}
      </ResourceView>
    </>
  )
}
