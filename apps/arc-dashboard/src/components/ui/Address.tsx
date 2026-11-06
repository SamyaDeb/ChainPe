import { ExternalLink } from 'lucide-react'
import { addressUrl, isAddressLike, shortHex, txUrl } from '@/lib/explorer'
import { CopyButton } from './Copy'

const linkCls = 'inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline'

/** 0x1234…abcd with copy. Links to the explorer only when the value is a real address. */
export function AddressView({ address, copy = true }: { address: string; copy?: boolean }) {
  const url = addressUrl(address)
  return (
    <span className="inline-flex items-center gap-0.5 font-mono text-sm tabular-nums">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={linkCls} aria-label={`Address ${address}, opens in the explorer`}>
          {shortHex(address)}
          <ExternalLink size={12} aria-hidden />
        </a>
      ) : (
        <span>{isAddressLike(address) ? shortHex(address) : address}</span>
      )}
      {copy && isAddressLike(address) ? <CopyButton value={address} label="address" /> : null}
    </span>
  )
}

/** A transaction hash as an explorer link. Anything that is not a hash is shown as plain text. */
export function TxLink({ hash, label = 'tx' }: { hash: string | null | undefined; label?: string }) {
  if (!hash) return <span className="text-muted">{'\u2014'}</span>
  const url = txUrl(hash)
  if (!url) return <span className="break-all font-mono text-xs">{hash.slice(0, 80)}</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={`${linkCls} font-mono text-sm`} aria-label={`${label} ${hash}, opens in the explorer`}>
      {shortHex(hash)}
      <ExternalLink size={12} aria-hidden />
    </a>
  )
}
