/**
 * "Try it": one real x402 paid call from the browser, every step on screen. Protocol logic lives in src/lib/x402.ts;
 * this file only drives the wallet and the two fetches. Nothing is signed before the 402 has been checked against the
 * registry, and every wallet action is its own button press (a phone wallet only opens from a user gesture).
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { CheckCircle2, CircleDashed, ExternalLink, Loader2, MinusCircle, Star as StarIcon, Wallet, X, XCircle } from 'lucide-react'
import { formatEther, type Address, type Hex } from 'viem'
import { useAccount } from 'wagmi'
import { signTypedData, switchChain, writeContract } from 'wagmi/actions'
import { publicApi } from '@/api/client'
import type { PublicService } from '@/api/schema'
import { AddressView } from '@/components/ui/Address'
import { Button, inputCls } from '@/components/ui/forms'
import { USE_MOCK } from '@/lib/env'
import { txUrl } from '@/lib/explorer'
import { formatPrice, formatUsdcExact, priceToAtomic } from '@/lib/money'
import { wagmiConfig } from '@/lib/wagmi'
import { errorText, isUserRejection, publicClient } from '@/lib/wallet'
import {
  AVALANCHE_CHAIN_ID,
  buildAuthorization,
  checkRequestUrl,
  decodePaymentResponse,
  encodePaymentHeader,
  ERC20_BALANCE_ABI,
  feedbackArgs,
  parsePaymentRequired,
  paymentPayload,
  randomNonce,
  REPUTATION_ABI,
  REPUTATION_REGISTRY,
  selectRequirements,
  USDC_ADDRESS,
  X402Error,
  type SettlementInfo,
  type ValidRequirements,
} from '@/lib/x402'

const REQUEST_TIMEOUT_MS = 20_000
const PAID_TIMEOUT_MS = 60_000
const RECEIPT_TIMEOUT_MS = 120_000
const REVIEW_POLL_MS = 5_000
const REVIEW_TIMEOUT_MS = 180_000
const BODY_LIMIT = 4_000

/** Shown when the service can be tried: an https endpoint and a price that reads as USDC. */
export function canTry(s: PublicService): boolean {
  return priceToAtomic(s.price) !== null && /^https:\/\//i.test(s.endpoint)
}

export function TryItButton({ s }: { s: PublicService }) {
  const [open, setOpen] = useState(false)
  if (!canTry(s)) return null
  return (
    <>
      <Button variant="primary" className="min-h-10 px-5" onClick={() => setOpen(true)}>
        Try it · {formatPrice(s.price)}
      </Button>
      {/* A portal: a card's entry animation uses transform, which would trap a fixed overlay inside the card. */}
      {open ? createPortal(<TryItModal s={s} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  )
}

type StepStatus = 'todo' | 'active' | 'done' | 'error' | 'skipped'

interface Balances {
  usdc: bigint
  avax: bigint
}

interface Flow {
  /** Where the flow stands. */
  phase: 'ready' | 'requesting' | 'checked' | 'refused' | 'signing' | 'paying' | 'paid' | 'rating' | 'confirming' | 'polling' | 'rated' | 'failed'
  requirementsJson: string | null
  requirements: ValidRequirements | null
  problems: string[]
  response: { status: number; body: string } | null
  settlement: SettlementInfo | null
  headerMissing: boolean
  ratingTx: Hex | null
  review: 'verified' | 'pending' | 'unverified' | 'timeout' | null
  reviewReason: string | null
  error: string | null
  /** The step the error belongs to. */
  errorAt: number | null
  /** One status per step, 0 to 5. */
  steps: StepStatus[]
}

const INITIAL: Flow = {
  phase: 'ready',
  requirementsJson: null,
  requirements: null,
  problems: [],
  response: null,
  settlement: null,
  headerMissing: false,
  ratingTx: null,
  review: null,
  reviewReason: null,
  error: null,
  errorAt: null,
  steps: ['todo', 'todo', 'todo', 'todo', 'todo', 'todo'],
}

const withStep = (steps: StepStatus[], i: number, status: StepStatus): StepStatus[] => steps.map((v, k) => (k === i ? status : v))

function fetchFailure(e: unknown, timeoutText: string): string {
  if (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'TimeoutError') return timeoutText
  return "Could not reach the endpoint. It may be down, or its CORS policy does not allow this page's origin (it must allow the X-PAYMENT header and expose X-PAYMENT-RESPONSE)."
}

async function readBody(res: Response): Promise<string> {
  const text = await res.text()
  let shown = text
  try {
    shown = JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    /* not JSON: show it as text */
  }
  return shown.length > BODY_LIMIT ? `${shown.slice(0, BODY_LIMIT)}\n… (${shown.length - BODY_LIMIT} more characters)` : shown
}

/** Switches the wallet to Avalanche C-Chain first: wallets refuse typed data whose chainId is not the active chain. */
async function ensureAvalanche(chainId: number | undefined): Promise<void> {
  if (chainId === AVALANCHE_CHAIN_ID) return
  await switchChain(wagmiConfig, { chainId: AVALANCHE_CHAIN_ID })
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <CheckCircle2 size={18} className="text-ok" aria-hidden />
  if (status === 'error') return <XCircle size={18} className="text-bad" aria-hidden />
  if (status === 'active') return <Loader2 size={18} className="animate-spin text-ink" aria-hidden />
  if (status === 'skipped') return <MinusCircle size={18} className="text-muted" aria-hidden />
  return <CircleDashed size={18} className="text-muted" aria-hidden />
}

const STATUS_TEXT: Record<StepStatus, string> = { todo: 'not started', active: 'in progress', done: 'done', error: 'stopped', skipped: 'skipped' }

function Step({ n, title, status, children }: { n: number; title: string; status: StepStatus; children?: ReactNode }) {
  return (
    <li className="border-t border-ink/10 py-4 first:border-t-0">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          <StepIcon status={status} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={status === 'todo' || status === 'skipped' ? 'text-muted' : 'text-ink'}>
            <span className="font-mono text-xs text-muted">{n}.</span> {title}
            <span className="sr-only"> ({STATUS_TEXT[status]})</span>
          </p>
          {children ? <div className="mt-2 flex flex-col gap-2 text-sm">{children}</div> : null}
        </div>
      </div>
    </li>
  )
}

function Code({ children, label }: { children: string; label: string }) {
  return (
    <pre aria-label={label} tabIndex={0} className="max-h-56 overflow-auto whitespace-pre-wrap break-all border border-ink/10 bg-subtle p-3 font-mono text-xs text-ink">
      {children}
    </pre>
  )
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="border border-bad bg-bad-soft px-3 py-2 text-sm text-bad">
      {children}
    </div>
  )
}

function TxRow({ label, hash }: { label: string; hash: string }) {
  const url = txUrl(hash)
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-muted">{label}</span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-mono text-xs text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
          {hash}
          <ExternalLink size={12} aria-hidden />
        </a>
      ) : (
        <span className="break-all font-mono text-xs">{hash}</span>
      )}
    </p>
  )
}

function StarPicker({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-label="Rating" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          disabled={disabled}
          onClick={() => onChange(n)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-300 hover:bg-ink/5 disabled:opacity-50"
        >
          <StarIcon size={20} className={n <= value ? 'fill-ink text-ink' : 'text-muted'} aria-hidden />
        </button>
      ))}
    </div>
  )
}

export function TryItModal({ s, onClose }: { s: PublicService; onClose: () => void }) {
  const titleId = useId()
  const urlId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const account = useAccount()
  const { openConnectModal } = useConnectModal()
  const [url, setUrl] = useState(s.endpoint)
  const [flow, setFlow] = useState<Flow>(INITIAL)
  // Keyed by wallet, so a switched account never shows the previous one's balances.
  const [balanceState, setBalanceState] = useState<{ who: string; balances: Balances | null; error: string | null } | null>(null)
  const [stars, setStars] = useState(5)
  const priceAtomic = priceToAtomic(s.price)
  const canRate = s.agentId !== null && /^\d+$/.test(s.agentId) && s.agentId !== '0'
  const address: Address | undefined = account.address
  const connected = account.status === 'connected' && address !== undefined
  const busy = ['requesting', 'signing', 'paying', 'rating', 'confirming', 'polling'].includes(flow.phase)

  const update = useCallback((patch: Partial<Flow>) => {
    if (alive.current) setFlow((f) => ({ ...f, ...patch }))
  }, [])

  // Escape closes, focus moves in and back out, the page behind does not scroll.
  useEffect(() => {
    alive.current = true
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      alive.current = false
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [onClose])

  // Re-read after a payment by bumping this from the event that made it.
  const [balanceTick, setBalanceTick] = useState(0)
  useEffect(() => {
    if (!address) return
    let cancelled = false
    const who = address
    Promise.all([
      publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [who] }),
      publicClient.getBalance({ address: who }),
    ]).then(
      ([usdc, avax]) => {
        if (!cancelled) setBalanceState({ who, balances: { usdc, avax }, error: null })
      },
      () => {
        if (!cancelled) setBalanceState({ who, balances: null, error: 'Could not read your balances from Avalanche.' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [address, balanceTick])
  const current = balanceState !== null && balanceState.who === address ? balanceState : null
  const balances = current?.balances ?? null
  const balanceError = current?.error ?? null

  const fail = (errorAt: number, error: string) => {
    if (alive.current) setFlow((f) => ({ ...f, phase: 'failed', error, errorAt, steps: withStep(f.steps, errorAt, 'error') }))
  }
  const step = (i: number, status: StepStatus, patch: Partial<Flow> = {}) => {
    if (alive.current) setFlow((f) => ({ ...f, ...patch, steps: withStep(f.steps, i, status) }))
  }

  /** Steps 1 and 2: the unpaid request, then the checks. Nothing is signed here. */
  const request = async () => {
    setFlow({ ...INITIAL, phase: 'requesting', steps: ['active', 'todo', 'todo', 'todo', 'todo', canRate ? 'todo' : 'skipped'] })
    let target: URL
    try {
      target = checkRequestUrl(s.endpoint, url.trim())
    } catch (e) {
      fail(0, errorText(e))
      return
    }
    let res: Response
    try {
      res = await fetch(target, { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch (e) {
      fail(0, fetchFailure(e, 'The endpoint did not answer in time.'))
      return
    }
    if (res.status !== 402) {
      const body = await readBody(res).catch(() => '')
      update({ response: { status: res.status, body } })
      fail(0, `Expected 402 Payment Required, got ${res.status}. ${res.ok ? 'This URL did not ask for payment.' : ''}`.trim())
      return
    }
    let raw: unknown
    try {
      raw = await res.json()
    } catch {
      fail(0, 'The 402 answer is not JSON.')
      return
    }
    try {
      const pr = parsePaymentRequired(raw)
      const requirementsJson = JSON.stringify(raw, null, 2)
      if (priceAtomic === null) {
        update({ phase: 'refused', requirementsJson, problems: [`The listed price "${s.price}" is not a USDC amount.`], steps: ['done', 'error', 'todo', 'todo', 'todo', 'todo'] })
        return
      }
      const sel = selectRequirements(pr, { payTo: s.payTo, priceAtomic })
      if (!sel.ok) {
        update({ phase: 'refused', requirementsJson, problems: sel.problems, steps: ['done', 'error', 'todo', 'todo', 'todo', 'todo'] })
        return
      }
      update({ phase: 'checked', requirementsJson, requirements: sel.requirements, problems: [], steps: ['done', 'done', 'todo', 'todo', 'todo', canRate ? 'todo' : 'skipped'] })
    } catch (e) {
      fail(0, e instanceof X402Error ? e.message : errorText(e))
    }
  }

  /** Steps 3 to 5: sign the authorization, retry with X-PAYMENT, read the settlement. */
  const pay = async () => {
    const requirements = flow.requirements
    if (!requirements || !address) return
    const amount = BigInt(requirements.maxAmountRequired)
    if (balances && balances.usdc < amount) {
      fail(2, `This wallet has ${formatUsdcExact(balances.usdc)} USDC on Avalanche; the call costs ${formatUsdcExact(amount)}.`)
      return
    }
    step(2, 'active', { phase: 'signing', error: null, errorAt: null })
    let header: string
    let validBefore: number
    try {
      await ensureAvalanche(account.chainId)
      const nowSec = Math.floor(Date.now() / 1000)
      const { authorization, typedData } = buildAuthorization({ from: address, requirements, nowSec, nonce: randomNonce() })
      validBefore = Number(authorization.validBefore)
      const signature = await signTypedData(wagmiConfig, { account: address, ...typedData })
      header = encodePaymentHeader(paymentPayload(requirements, authorization, signature))
    } catch (e) {
      fail(2, isUserRejection(e) ? 'You rejected the request in your wallet. Nothing was paid.' : `Could not sign: ${errorText(e)}`)
      return
    }
    if (Math.floor(Date.now() / 1000) >= validBefore - 5) {
      fail(2, 'The authorization expired while waiting for the signature. Nothing was paid; start again.')
      return
    }

    setFlow((f) => ({ ...f, phase: 'paying', steps: withStep(withStep(f.steps, 2, 'done'), 3, 'active') }))
    let res: Response
    try {
      const target = checkRequestUrl(s.endpoint, url.trim())
      res = await fetch(target, {
        headers: { Accept: 'application/json', 'X-PAYMENT': header },
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(PAID_TIMEOUT_MS),
      })
    } catch (e) {
      fail(3, fetchFailure(e, 'The paid request timed out. The payment may still settle: check your wallet on Snowtrace before retrying.'))
      return
    }
    const body = await readBody(res).catch(() => '')
    const settlement = decodePaymentResponse(res.headers.get('X-PAYMENT-RESPONSE'))
    step(4, settlement?.transaction ? 'done' : 'skipped', { response: { status: res.status, body }, settlement, headerMissing: settlement === null })
    if (res.status === 402) {
      fail(3, 'The server refused the payment (402 again). Nothing settled; see the response below.')
      return
    }
    if (!res.ok) {
      fail(3, `The paid request failed with ${res.status}. If a settlement is shown, the payment went through.`)
      return
    }
    step(3, 'done', { phase: 'paid' })
    setBalanceTick((t) => t + 1)
  }

  /** Step 6: giveFeedback with the settlement tx as proof, then wait for chainpe-cloud to verify it. */
  const rate = async () => {
    const tx = flow.settlement?.transaction
    if (!tx || !s.agentId || !address) return
    if (balances && balances.avax === 0n) {
      fail(5, 'This wallet has no AVAX for gas. Rating is an on-chain transaction; the payment above is already done.')
      return
    }
    step(5, 'active', { phase: 'rating', error: null, errorAt: null })
    let hash: Hex
    try {
      await ensureAvalanche(account.chainId)
      hash = await writeContract(wagmiConfig, {
        address: REPUTATION_REGISTRY,
        abi: REPUTATION_ABI,
        functionName: 'giveFeedback',
        args: feedbackArgs({ agentId: s.agentId, stars, url: url.trim(), settlementTx: tx }),
        chainId: AVALANCHE_CHAIN_ID,
      })
    } catch (e) {
      fail(5, isUserRejection(e) ? 'You rejected the rating transaction. Your payment is unaffected.' : `Could not send the rating: ${errorText(e)}`)
      return
    }
    update({ phase: 'confirming', ratingTx: hash })
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS })
      if (receipt.status !== 'success') {
        fail(5, 'The rating transaction reverted on Avalanche.')
        return
      }
    } catch {
      fail(5, 'The rating transaction has not confirmed yet. Check it on Snowtrace; it shows on the service page once indexed.')
      return
    }

    update({ phase: 'polling' })
    const deadline = Date.now() + REVIEW_TIMEOUT_MS
    while (alive.current && Date.now() < deadline) {
      try {
        const page = await publicApi.publicReviews(s.key, { limit: 20 })
        const mine = page.reviews.find((r) => r.txHash.toLowerCase() === hash.toLowerCase())
        if (mine && mine.status !== 'pending') {
          step(5, mine.status === 'verified' ? 'done' : 'error', { phase: 'rated', review: mine.status, reviewReason: mine.verificationReason })
          return
        }
        if (mine) update({ review: 'pending' })
      } catch {
        /* keep polling: the API may be briefly unreachable */
      }
      await new Promise((r) => window.setTimeout(r, REVIEW_POLL_MS))
    }
    step(5, 'skipped', { phase: 'rated', review: 'timeout' })
  }

  const [s0, s1, s2, s3, s4, s5] = flow.steps as [StepStatus, StepStatus, StepStatus, StepStatus, StepStatus, StepStatus]
  const lowUsdc = balances !== null && priceAtomic !== null && balances.usdc < BigInt(priceAtomic)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="rise flex max-h-[100dvh] w-full max-w-2xl flex-col border border-ink bg-bg outline-none sm:max-h-[90dvh]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink/10 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted">x402 paid call · Avalanche mainnet</p>
            <h2 id={titleId} className="mt-1 break-words font-display text-3xl tracking-tight text-ink sm:text-4xl">
              Try {s.name} · {formatPrice(s.price)}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/5 hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <p className="text-sm text-muted">
            This makes a real call and pays {formatPrice(s.price)} in USDC from your wallet. The service&apos;s facilitator submits the payment and pays its gas. You sign one authorization, and only after the 402 has been checked against the registry.
          </p>
          {USE_MOCK ? <p className="mt-3 border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">Sample data: these endpoints are not real, so the request will fail.</p> : null}

          <div className="mt-4 flex flex-col gap-2">
            <label htmlFor={urlId} className="text-sm font-medium text-ink">
              Request URL
            </label>
            <input id={urlId} className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy || flow.phase === 'checked' || flow.response !== null && flow.errorAt !== 0} spellCheck={false} autoComplete="off" inputMode="url" />
            <p className="text-xs text-muted">You can add a query, e.g. ?city=Paris. It must stay on this service&apos;s endpoint.</p>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border border-ink/10 px-3 py-2 text-sm">
            {connected ? (
              <>
                <AddressView address={address} />
                <span className="font-mono text-xs text-muted">
                  {balances ? `${formatUsdcExact(balances.usdc)} USDC · ${Number(formatEther(balances.avax)).toFixed(4)} AVAX` : balanceError ?? 'Reading balances…'}
                </span>
                {account.chainId !== AVALANCHE_CHAIN_ID ? <span className="w-full text-xs text-warn">Your wallet is on another network. It will be asked to switch to Avalanche C-Chain.</span> : null}
                {lowUsdc ? <span className="w-full text-xs text-bad">Not enough USDC on Avalanche for this call.</span> : null}
              </>
            ) : (
              <>
                <span className="text-muted">No wallet connected. You can still see the 402.</span>
                <Button className="min-h-10 px-4" onClick={() => openConnectModal?.()}>
                  <Wallet size={16} aria-hidden /> Connect wallet
                </Button>
              </>
            )}
          </div>

          <ol className="mt-4" aria-live="polite">
            <Step n={1} title="Request the endpoint and expect 402 Payment Required" status={s0}>
              {flow.errorAt === 0 && flow.error ? <Problem>{flow.error}</Problem> : null}
              {flow.requirementsJson ? <Code label="Payment requirements">{flow.requirementsJson}</Code> : null}
              {flow.errorAt === 0 && flow.response ? <Code label="Response body">{flow.response.body || '(empty body)'}</Code> : null}
            </Step>
            <Step n={2} title="Check the offer against the registry before signing" status={s1}>
              {flow.requirements ? (
                <p className="text-muted">
                  Avalanche, exact, native USDC, {formatUsdcExact(flow.requirements.maxAmountRequired)} to this service&apos;s registered payTo, valid {flow.requirements.maxTimeoutSeconds} s. Safe to sign.
                </p>
              ) : null}
              {flow.phase === 'refused' ? (
                <Problem>
                  <p className="font-semibold">Refused. Nothing was signed.</p>
                  <ul className="mt-1 list-disc pl-5">
                    {flow.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </Problem>
              ) : null}
            </Step>
            <Step n={3} title="Sign the USDC transfer authorization (EIP-3009)" status={s2}>
              {flow.errorAt === 2 && flow.error ? <Problem>{flow.error}</Problem> : null}
              {flow.phase === 'signing' ? <p className="text-muted">Approve the signature in your wallet. It authorizes exactly this amount to this payTo, once.</p> : null}
            </Step>
            <Step n={4} title="Retry with the X-PAYMENT header" status={s3}>
              {flow.errorAt === 3 && flow.error ? <Problem>{flow.error}</Problem> : null}
              {flow.response && flow.errorAt !== 0 ? (
                <>
                  <p className="font-mono text-xs text-muted">HTTP {flow.response.status}</p>
                  <Code label="Response body">{flow.response.body || '(empty body)'}</Code>
                </>
              ) : null}
            </Step>
            <Step n={5} title="Settlement on Avalanche" status={s4}>
              {flow.settlement?.transaction ? <TxRow label="Settlement tx" hash={flow.settlement.transaction} /> : null}
              {flow.settlement && !flow.settlement.transaction ? <p className="text-muted">X-PAYMENT-RESPONSE was read, but it names no transaction.</p> : null}
              {flow.headerMissing && flow.response ? (
                <p className="text-muted">
                  No X-PAYMENT-RESPONSE header was readable. Either the server did not send one, or its CORS policy does not expose it to this page. The payment still shows in the live feed once it settles.
                </p>
              ) : null}
            </Step>
            <Step n={6} title={canRate ? 'Rate it (optional)' : 'Rate it: this service has no ERC-8004 agent'} status={s5}>
              {canRate && flow.settlement?.transaction && (flow.phase === 'paid' || flow.errorAt === 5) ? (
                <>
                  <StarPicker value={stars} onChange={setStars} disabled={busy} />
                  <p className="text-xs text-muted">
                    Sends giveFeedback to the ERC-8004 ReputationRegistry with the settlement tx as proof. This is an on-chain transaction: it costs a little AVAX for gas.
                  </p>
                </>
              ) : null}
              {flow.errorAt === 5 && flow.error ? <Problem>{flow.error}</Problem> : null}
              {flow.ratingTx ? <TxRow label="Rating tx" hash={flow.ratingTx} /> : null}
              {flow.phase === 'confirming' ? <p className="text-muted">Waiting for the rating to confirm.</p> : null}
              {flow.phase === 'polling' ? <p className="text-muted">Confirmed. Waiting for ChainPe to check the payment behind it.</p> : null}
              {flow.review === 'verified' ? (
                <p className="flex items-center gap-2 text-ok">
                  <CheckCircle2 size={16} aria-hidden /> Verified paid review. It counts toward the paid score.
                </p>
              ) : null}
              {flow.review === 'unverified' ? <Problem>Indexed but not verified{flow.reviewReason ? ` (${flow.reviewReason})` : ''}.</Problem> : null}
              {flow.review === 'timeout' ? <p className="text-muted">Not verified yet. Indexing can take a few minutes; the review shows on the service page once checked.</p> : null}
            </Step>
          </ol>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ink/10 px-4 py-4 sm:px-6">
          <Button variant="ghost" onClick={onClose}>
            {flow.phase === 'paid' || flow.phase === 'rated' ? 'Done' : 'Close'}
          </Button>
          {flow.phase === 'ready' || (flow.phase === 'failed' && flow.errorAt !== 2 && flow.errorAt !== 5) || flow.phase === 'refused' ? (
            <Button variant="primary" onClick={() => void request()}>
              {flow.phase === 'ready' ? 'Send request' : 'Start again'}
            </Button>
          ) : null}
          {flow.phase === 'requesting' ? (
            <Button variant="primary" disabled>
              <Loader2 size={16} className="animate-spin" aria-hidden /> Requesting
            </Button>
          ) : null}
          {flow.phase === 'checked' || (flow.phase === 'failed' && flow.errorAt === 2) ? (
            connected ? (
              <Button variant="primary" disabled={lowUsdc} onClick={() => void pay()}>
                <Wallet size={16} aria-hidden /> Sign and pay {formatUsdcExact(flow.requirements?.maxAmountRequired ?? null)}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => openConnectModal?.()}>
                <Wallet size={16} aria-hidden /> Connect wallet to pay
              </Button>
            )
          ) : null}
          {flow.phase === 'signing' || flow.phase === 'paying' ? (
            <Button variant="primary" disabled>
              <Loader2 size={16} className="animate-spin" aria-hidden /> {flow.phase === 'signing' ? 'Waiting for signature' : 'Paying'}
            </Button>
          ) : null}
          {canRate && flow.settlement?.transaction && (flow.phase === 'paid' || flow.errorAt === 5) ? (
            <Button variant="primary" disabled={!connected} onClick={() => void rate()}>
              <StarIcon size={16} aria-hidden /> Rate {stars}★ on-chain
            </Button>
          ) : null}
          {flow.phase === 'rating' || flow.phase === 'confirming' || flow.phase === 'polling' ? (
            <Button variant="primary" disabled>
              <Loader2 size={16} className="animate-spin" aria-hidden /> {flow.phase === 'rating' ? 'Waiting for wallet' : flow.phase === 'confirming' ? 'Confirming' : 'Verifying'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
