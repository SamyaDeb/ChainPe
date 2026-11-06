import { Card, PageHeader, SectionTitle } from '@/components/ui/Card'
import { CommandBlock } from '@/components/ui/Copy'
import { Keys } from './settings/Keys'
import { Wallets } from './settings/Wallets'

export function SettingsScreen() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Connect your proxy and mark your own wallets." />
      <div className="flex flex-col gap-6">
        <Keys />
        <Card>
          <SectionTitle>Telemetry</SectionTitle>
          <p className="max-w-prose text-sm text-muted">
            Your proxy reports each paid call and a periodic heartbeat to ChainPe. That is where this dashboard gets its numbers. Payments made with{' '}
            <code className="font-mono">--no-telemetry</code> are never reported, so they show up only as unattributed inflow.
          </p>
          <div className="mt-3 max-w-md">
            <CommandBlock command="chainpe login" />
          </div>
        </Card>
        <Wallets />
      </div>
    </>
  )
}
