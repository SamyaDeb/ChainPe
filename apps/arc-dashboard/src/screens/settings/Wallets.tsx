import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { getAddress, isAddress } from 'viem'
import { useAuth } from '@/auth/AuthContext'
import { AddressView } from '@/components/ui/Address'
import { Card, SectionTitle } from '@/components/ui/Card'
import { Button, Field, inputCls } from '@/components/ui/forms'
import { ErrorState, ResourceView } from '@/components/ui/States'
import { useResource } from '@/hooks/useResource'

const MAX_WALLETS = 50

export function Wallets() {
  const { api, handleError } = useAuth()
  const wallets = useResource('wallets', () => api.wallets())
  const [saved, setSaved] = useState<string[] | null>(null)
  const [draft, setDraft] = useState<string[] | null>(null)
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const add = (base: string[]) => {
    const value = input.trim()
    if (!isAddress(value)) {
      setInputError('Enter a valid wallet address: 0x followed by 40 hex characters. Mixed-case addresses must have a valid checksum.')
      return
    }
    const next = getAddress(value)
    if (base.some((w) => w.toLowerCase() === next.toLowerCase())) {
      setInputError('That wallet is already in the list.')
      return
    }
    if (base.length >= MAX_WALLETS) {
      setInputError(`You can list at most ${MAX_WALLETS} wallets.`)
      return
    }
    setInputError(null)
    setNotice(null)
    setDraft([...base, next])
    setInput('')
  }

  const save = async (list: string[]) => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await api.putWallets(list)
      setSaved(res.wallets)
      setDraft(null)
      setConfirming(false)
      setNotice('Saved. This is the list the server now holds.')
    } catch (e) {
      if (!handleError(e)) setSaveError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <SectionTitle>My wallets</SectionTitle>
      <p className="mb-3 max-w-prose text-sm text-muted">
        Other wallets you own. Payments from them, past and future, are marked self-pay and do not count as revenue.
      </p>
      <ResourceView resource={wallets} skeletonRows={2}>
        {(d) => {
          const current = saved ?? d.wallets
          const shown = draft ?? current
          return (
            <div className="flex flex-col gap-3">
              {shown.length === 0 ? (
                <p className="text-sm text-muted">No wallets listed.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                  {shown.map((w) => (
                    <li key={w} className="flex items-center justify-between gap-2 px-3 py-1">
                      <AddressView address={w} />
                      <Button variant="ghost" aria-label={`Remove ${w}`} onClick={() => { setDraft(shown.filter((x) => x !== w)); setNotice(null) }}>
                        <Trash2 size={16} aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  add(shown)
                }}
              >
                <div className="min-w-56 flex-1">
                  <Field label="Add a wallet" htmlFor="wallet-input" hint={inputError ? undefined : 'Paste a 0x address.'}>
                    <input
                      id="wallet-input"
                      className={inputCls}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="0x..."
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={inputError !== null}
                      aria-describedby={inputError ? 'wallet-error' : undefined}
                    />
                  </Field>
                  {inputError ? (
                    <p id="wallet-error" role="alert" className="mt-1 text-xs text-bad">
                      {inputError}
                    </p>
                  ) : null}
                </div>
                <Button type="submit">Add</Button>
              </form>

              {draft !== null && !confirming ? (
                <Button variant="primary" className="self-start" onClick={() => setConfirming(true)}>
                  Save wallets
                </Button>
              ) : null}

              {confirming && draft !== null ? (
                <div role="alertdialog" aria-label="Confirm replacing your wallet list" className="rounded-md border border-warn bg-warn-soft p-3">
                  <p className="text-sm font-semibold text-warn">Replace your wallet list?</p>
                  <p className="mt-1 text-sm text-ink">
                    Saving replaces the whole list on the server with the {draft.length} {draft.length === 1 ? 'wallet' : 'wallets'} shown. Payments from
                    those wallets, past and future, are marked self-pay and leave your revenue totals.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="primary" disabled={saving} onClick={() => void save(draft)}>
                      {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                      Replace list
                    </Button>
                    <Button onClick={() => setConfirming(false)}>Cancel</Button>
                    <Button variant="ghost" onClick={() => { setDraft(null); setConfirming(false) }}>
                      Discard changes
                    </Button>
                  </div>
                </div>
              ) : null}

              {saveError ? <ErrorState error={saveError} /> : null}
              {notice ? (
                <p role="status" className="text-sm text-ok">
                  {notice}
                </p>
              ) : null}
            </div>
          )
        }}
      </ResourceView>
    </Card>
  )
}
