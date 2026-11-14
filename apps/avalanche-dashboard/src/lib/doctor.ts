/** The `chainpe doctor --json` report, as sent in heartbeats. Parsed defensively: older reports omit fields. */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown' | 'skip' | 'info'

export interface DoctorCheck {
  id: number | null
  name: string
  status: CheckStatus
  required: boolean
  detail: string
  diff: string[]
}

export interface DoctorReport {
  ok: boolean
  allGreen: boolean
  passed: number
  total: number
  generatedAt: string | null
  endpoint: string | null
  service: string | null
  network: string | null
  checks: DoctorCheck[]
}

const STATUSES: readonly string[] = ['pass', 'warn', 'fail', 'unknown', 'skip', 'info']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function parseCheck(v: unknown): DoctorCheck | null {
  if (!isRecord(v)) return null
  const status = typeof v.status === 'string' && STATUSES.includes(v.status) ? (v.status as CheckStatus) : 'unknown'
  return {
    id: typeof v.id === 'number' ? v.id : null,
    name: str(v.name) ?? 'Unnamed check',
    status,
    required: v.required === true,
    detail: str(v.detail) ?? '',
    diff: Array.isArray(v.diff) ? v.diff.filter((d): d is string => typeof d === 'string') : [],
  }
}

export function parseDoctor(value: unknown): DoctorReport | null {
  if (!isRecord(value)) return null
  const score = isRecord(value.score) ? value.score : null
  const passed = score && typeof score.passed === 'number' ? score.passed : null
  const total = score && typeof score.total === 'number' ? score.total : null
  if (passed === null || total === null || typeof value.ok !== 'boolean') return null
  const checks = Array.isArray(value.checks)
    ? value.checks.map(parseCheck).filter((c): c is DoctorCheck => c !== null)
    : []
  return {
    ok: value.ok,
    allGreen: value.allGreen === true,
    passed,
    total,
    generatedAt: str(value.generatedAt),
    endpoint: str(value.endpoint),
    service: str(value.service),
    network: str(value.network),
    checks,
  }
}
