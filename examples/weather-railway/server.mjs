/**
 * ChainPe demo backend (zero dependencies, plain Node http)
 *
 * The BACKEND behind examples/proxy-railway. Do not expose or register this URL
 * on-chain; register the x402 proxy routes that wrap it.
 *
 * Run locally:
 *   node examples/weather-railway/server.mjs            # listens on :3001
 *   PORT=4000 node examples/weather-railway/server.mjs
 *
 * Endpoints (the first three are the paid services behind the proxy):
 *   GET  /weather?city=London        current weather (sample data)
 *   GET  /summarize?text=...         deterministic extractive summary, no API keys
 *   POST /summarize {"text": "..."}  same, for longer input
 *   GET  /cheap-weather?city=London  DELIBERATELY low-quality data (reputation-gating demo)
 *   GET  /forecast?city=Tokyo        5-day forecast
 *   GET  /cities                     known cities
 *   GET  /health                     health check
 */

import http from 'node:http'

const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '::' // Railway private networking is IPv6

const CITIES = {
  london: { city: 'London', country: 'GB', temp: 12, desc: 'Partly cloudy', humidity: 78, wind: 5.2 },
  'new york': { city: 'New York', country: 'US', temp: 18, desc: 'Clear sky', humidity: 65, wind: 3.8 },
  tokyo: { city: 'Tokyo', country: 'JP', temp: 22, desc: 'Light rain', humidity: 70, wind: 4.5 },
  paris: { city: 'Paris', country: 'FR', temp: 15, desc: 'Overcast', humidity: 72, wind: 4.0 },
  dubai: { city: 'Dubai', country: 'AE', temp: 35, desc: 'Sunny', humidity: 45, wind: 6.2 },
  mumbai: { city: 'Mumbai', country: 'IN', temp: 30, desc: 'Humid and warm', humidity: 80, wind: 3.2 },
  sydney: { city: 'Sydney', country: 'AU', temp: 24, desc: 'Few clouds', humidity: 68, wind: 5.5 },
  berlin: { city: 'Berlin', country: 'DE', temp: 11, desc: 'Cloudy', humidity: 70, wind: 4.8 }
}

function weatherFor(cityRaw) {
  const key = String(cityRaw || '').toLowerCase().trim()
  if (CITIES[key]) return { ...CITIES[key], source: 'ChainPe Weather (sample data)' }
  // Deterministic-ish fallback for unknown cities
  const temp = 10 + ((key.length * 7) % 25)
  return {
    city: cityRaw ? cityRaw[0].toUpperCase() + cityRaw.slice(1) : 'Unknown',
    country: 'XX',
    temp,
    desc: 'Mild',
    humidity: 60,
    wind: 4.0,
    source: 'ChainPe Weather (generated)'
  }
}

// ── summarize: extractive, deterministic (same input → same output) ────────
const STOPWORDS = new Set(
  ('a an and are as at be but by for from has have he her his i in is it its of on or our she so that the their them ' +
    'there they this to was we were what when which who will with you your not no can do does did than then into about').split(' ')
)
const SAMPLE_TEXT =
  'Avalanche C-Chain finalizes transactions in about one to two seconds. ChainPe uses that speed to settle x402 payments ' +
  'in USDC inside a single HTTP request. An agent receives a 402 response, signs an EIP-3009 authorization, and retries. ' +
  'The facilitator submits the signed transfer and pays the gas. Providers are listed in an on-chain registry, and ' +
  'agents rate them through ERC-8004 reputation after each paid call.'

function summarize(textRaw, maxSentences = 2) {
  const text = String(textRaw || '').replace(/\s+/g, ' ').trim()
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? []
  const words = (str) => str.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []
  const freq = new Map()
  for (const w of words(text)) if (!STOPWORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1)
  const scored = sentences.map((sentence, index) => {
    const ws = words(sentence).filter((w) => !STOPWORDS.has(w))
    const score = ws.length ? ws.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0) / ws.length : 0
    return { sentence, index, score }
  })
  const picked = [...scored]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, maxSentences))
    .sort((a, b) => a.index - b.index)
  // Most frequent first; ties keep first-occurrence order (Array#sort is stable).
  const keywords = [...freq.entries()]
    .filter(([w]) => w.length > 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w)
  return {
    summary: picked.map((p) => p.sentence).join(' '),
    keywords,
    sentences: { input: sentences.length, output: picked.length },
    method: 'extractive (word-frequency), deterministic',
  }
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ── cheap-weather: deliberately bad data, for the reputation-gating demo ────
// Wrong city, impossible temperature, a stale timestamp, no units. Deterministic so the demo repeats.
function cheapWeatherFor(cityRaw) {
  return {
    success: true,
    data: {
      location: { city: 'Unknown', country: '??' },
      requested: String(cityRaw || ''),
      current: { temperature: 999, description: 'n/a', humidity: -1, windSpeed: null },
      timestamp: '1970-01-01T00:00:00.000Z',
      source: 'cheap-weather (stale cache)',
    },
  }
}

function send(res, status, obj) {
  const body = JSON.stringify(obj, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  if (path === '/health') {
    return send(res, 200, { status: 'healthy', service: 'ChainPe Weather API', time: new Date().toISOString() })
  }

  if (path === '/weather' || path === '/') {
    // Default to London so a bare call to the service endpoint still returns data.
    const city = url.searchParams.get('city') || 'London'
    const w = weatherFor(city)
    return send(res, 200, {
      success: true,
      data: {
        location: { city: w.city, country: w.country },
        current: { temperatureC: w.temp, description: w.desc, humidity: w.humidity, windSpeed: w.wind },
        timestamp: new Date().toISOString(),
        source: w.source
      }
    })
  }

  if (path === '/summarize') {
    if (req.method === 'POST') {
      readBody(req)
        .then((raw) => {
          let text = raw
          let max = Number(url.searchParams.get('sentences') || 2)
          try {
            const j = JSON.parse(raw)
            text = j.text ?? ''
            if (j.sentences) max = Number(j.sentences)
          } catch {
            /* plain text body */
          }
          if (!String(text).trim()) return send(res, 400, { success: false, error: 'Send {"text": "..."}' })
          send(res, 200, { success: true, data: summarize(text, Math.min(max || 2, 10)) })
        })
        .catch((e) => send(res, 413, { success: false, error: e.message }))
      return
    }
    const text = url.searchParams.get('text') || SAMPLE_TEXT
    const max = Number(url.searchParams.get('sentences') || 2)
    return send(res, 200, { success: true, data: summarize(text, Math.min(max || 2, 10)) })
  }

  if (path === '/cheap-weather') {
    return send(res, 200, cheapWeatherFor(url.searchParams.get('city') || 'London'))
  }

  if (path === '/forecast') {
    const city = url.searchParams.get('city') || 'London'
    const base = weatherFor(city)
    const days = Array.from({ length: 5 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() + i + 1)
      return {
        date: d.toISOString().split('T')[0],
        temperatureC: base.temp + ((i * 3) % 7) - 3,
        description: base.desc
      }
    })
    return send(res, 200, { success: true, data: { location: { city: base.city, country: base.country }, forecast: days } })
  }

  if (path === '/cities') {
    return send(res, 200, { success: true, cities: Object.values(CITIES).map((c) => c.city) })
  }

  return send(res, 404, { success: false, error: `Not found: ${path}` })
})

server.listen(PORT, HOST, () => {
  console.log(`ChainPe Weather API listening on http://localhost:${PORT}`)
  console.log(`  Try: curl "http://localhost:${PORT}/weather?city=London"`)
  console.log(`       curl "http://localhost:${PORT}/summarize?text=First.%20Second%20sentence."`)
  console.log(`       curl "http://localhost:${PORT}/cheap-weather?city=London"`)
  console.log('')
  console.log('Put examples/proxy-railway in front of this backend, then register its routes.')
})
