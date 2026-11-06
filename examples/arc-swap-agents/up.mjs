/**
 * Runs all three agents until you press Ctrl-C. For each one: a public HTTPS tunnel,
 * the on-chain identity and listing pointed at that URL, the backend, and the paying
 * proxy. Quick tunnels get a new URL each run, so every run updates the listings,
 * which costs a little testnet gas.
 *
 * `--local` skips the tunnels and the listings. The agents answer on 127.0.0.1 only,
 * so payments and swaps can be tested, but discovery and reputation cannot.
 */
import 'dotenv/config'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { AGENTS } from './agents.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.join(here, '../../packages/chainpe/dist/cli.js')
const logs = path.join(here, 'logs')
const run = promisify(execFile)
const children = []
const LOCAL = process.argv.includes('--local')
fs.mkdirSync(logs, { recursive: true })

function launch(id, label, command, args, env = {}) {
  const log = fs.openSync(path.join(logs, `${id}-${label}.log`), 'w')
  const child = spawn(command, args, { cwd: here, env: { ...process.env, ...env }, stdio: ['ignore', log, log] })
  children.push(child)
  return { child, logFile: path.join(logs, `${id}-${label}.log`) }
}

async function waitFor(what, read, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const value = await read().catch(() => undefined)
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Timed out waiting for ${what}.`)
}

async function startAgent(id, agent) {
  const configFile = path.join(here, 'generated', `${id}.json`)
  const env = {
    CHAINPE_CONFIG: configFile,
    CHAINPE_NETWORK: 'arc-testnet',
    CHAINPE_SELLER_PRIVATE_KEY: process.env[agent.envKey],
  }
  const chainpe = (...args) => run('node', [cli, ...args], { cwd: here, env: { ...process.env, ...env } })

  if (!LOCAL) {
    const { logFile } = launch(id, 'tunnel', 'cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${agent.proxyPort}`])
    const publicUrl = await waitFor(`${agent.name} tunnel`, async () =>
      /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(fs.readFileSync(logFile, 'utf8'))?.[0]
    )

    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    fs.writeFileSync(configFile, JSON.stringify({ ...config, publicUrl }, null, 2) + '\n')

    await chainpe('identity', '--update-uri')
    await chainpe('register')
    // Doctor checks the live URL too, which is not up yet. Only its documents matter here.
    await chainpe('doctor', '--regenerate').catch(() => {})
  }

  launch(id, 'backend', 'node', ['swap-agent.mjs', id])
  launch(id, 'proxy', 'node', [cli, 'start'], env)
  await waitFor(`${agent.name} backend`, async () => (await fetch(`http://127.0.0.1:${agent.backendPort}/health`)).ok)
  await waitFor(`${agent.name} proxy`, async () => (await fetch(`http://127.0.0.1:${agent.proxyPort}/health`)).ok)

  const { agentId, publicUrl } = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  console.log(`  ✓ ${agent.name.padEnd(12)} ${LOCAL ? `http://127.0.0.1:${agent.proxyPort}` : `agentId ${agentId}  ${publicUrl}`}`)
}

function stop(code) {
  for (const child of children) child.kill()
  process.exit(code)
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

try {
  // One at a time, so a failure is easy to read in the logs.
  for (const [id, agent] of Object.entries(AGENTS)) await startAgent(id, agent)
  console.log('\nAll agents are up. Logs are in examples/arc-swap-agents/logs. Press Ctrl-C to stop.')
} catch (err) {
  console.error(`✗ ${err.stderr || err.message}`)
  stop(1)
}
