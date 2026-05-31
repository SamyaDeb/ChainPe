import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { WalletFileConfig } from '@/types.js'

const WALLET_DIR = path.join(os.homedir(), '.chainpe')
const WALLET_PATH = path.join(WALLET_DIR, 'wallet.json')

export function loadWalletConfig(): WalletFileConfig | null {
  try {
    const raw = fs.readFileSync(WALLET_PATH, 'utf-8')
    return JSON.parse(raw) as WalletFileConfig
  } catch {
    return null
  }
}

export function saveWalletConfig(config: Partial<WalletFileConfig>): void {
  const existing = loadWalletConfig()
  const merged = { ...existing, ...config }
  fs.mkdirSync(WALLET_DIR, { recursive: true, mode: 0o700 })
  fs.writeFileSync(WALLET_PATH, JSON.stringify(merged, null, 2) + '\n', {
    mode: 0o600
  })
}

export function getWalletPath(): string {
  return WALLET_PATH
}
