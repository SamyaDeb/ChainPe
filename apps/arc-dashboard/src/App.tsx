import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AuthProvider, useAuth } from '@/auth/AuthContext'
import { WalletProviders } from '@/auth/WalletProviders'
import { AppShell } from '@/components/AppShell'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/forms'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { CONFIG_ERROR } from '@/lib/env'
import { usePath } from '@/lib/router'
import { Billing } from '@/screens/Billing'
import { Buyers } from '@/screens/Buyers'
import { Health } from '@/screens/Health'
import { Overview } from '@/screens/Overview'
import { Payments } from '@/screens/Payments'
import { Reputation } from '@/screens/Reputation'
import { Services } from '@/screens/Services'
import { SettingsScreen } from '@/screens/Settings'
import { SignIn } from '@/screens/SignIn'

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mx-auto max-w-md p-4">
        <Card as="div">
          <p className="font-semibold text-ink">Something broke while drawing this page.</p>
          <Button className="mt-3" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </Card>
      </div>
    )
  }
}

function Routes() {
  const path = usePath()
  switch (path) {
    case '/services':
      return <Services />
    case '/payments':
      return <Payments />
    case '/buyers':
      return <Buyers />
    case '/reputation':
      return <Reputation />
    case '/health':
      return <Health />
    case '/billing':
      return <Billing />
    case '/settings':
      return <SettingsScreen />
    default:
      return <Overview />
  }
}

function Authenticated() {
  const { me, meError, reloadMe, signOut } = useAuth()
  return (
    <AppShell>
      {me ? (
        <Routes />
      ) : meError ? (
        <div className="flex flex-col gap-3">
          <ErrorState error={meError} onRetry={reloadMe} />
          <Button className="self-start" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      ) : (
        <Skeleton rows={4} />
      )}
    </AppShell>
  )
}

function Gate() {
  const { session } = useAuth()
  return session ? <Authenticated key={session.token} /> : <SignIn />
}

export default function App() {
  if (CONFIG_ERROR) {
    return (
      <div className="mx-auto max-w-md p-4">
        <Card as="div" className="border-bad">
          <h1 className="text-lg font-semibold text-ink">Configuration error</h1>
          <p role="alert" className="mt-2 text-sm text-muted">
            {CONFIG_ERROR}
          </p>
        </Card>
      </div>
    )
  }
  return (
    <Boundary>
      <WalletProviders>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </WalletProviders>
    </Boundary>
  )
}
