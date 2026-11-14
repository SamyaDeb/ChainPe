import { Card, PageHeader, SectionTitle } from '@/components/ui/Card'
import { Keys } from './settings/Keys'
import { Wallets } from './settings/Wallets'

export function SettingsScreen() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Mark your own wallets, and connect a proxy that reports calls." />
      <div className="flex flex-col gap-6">
        <Keys />
        <Card>
          <SectionTitle>Where the numbers come from</SectionTitle>
          <p className="max-w-prose text-sm text-muted">
            On Avalanche this dashboard reads payments straight from the chain: a USDC transfer to a service&rsquo;s payout address for exactly its price counts as a verified payment. Nothing has to be installed or reported.
          </p>
          <p className="mt-3 max-w-prose text-sm text-muted">
            A proxy that reports calls with an ingest key adds the route, latency and failed calls, and its heartbeat fills in Listing health. The ChainPe CLI for Avalanche does not report calls yet.
          </p>
        </Card>
        <Wallets />
      </div>
    </>
  )
}
