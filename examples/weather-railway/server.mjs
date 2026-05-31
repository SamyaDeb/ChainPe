/**
 * ChainPe Weather API (zero-dependency backend)
 *
 * A simple weather backend you can monetize with ChainPe. It has NO npm
 * dependencies — just Node's built-in http server — so it runs anywhere.
 *
 * This is the BACKEND that ChainPe proxies. You do NOT register this URL
 * on-chain directly; you register the ChainPe x402 proxy that wraps it.
 *
 * Run:
 *   node examples/chainpe-weather-api.mjs            # listens on :3001
 *   PORT=4000 node examples/chainpe-weather-api.mjs  # custom port
 *
 * Endpoints:
 *   GET /health              → health check
 *   GET /weather?city=London → current weather (this is the paid resource)
 *   GET /forecast?city=Tokyo → 5-day forecast
 *   GET /cities              → list of known cities
 */

import http from 'node:http'

const PORT = Number(process.env.PORT || 3001)

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

server.listen(PORT, () => {
  console.log(`ChainPe Weather API listening on http://localhost:${PORT}`)
  console.log(`  Try: curl "http://localhost:${PORT}/weather?city=London"`)
  console.log('')
  console.log('Next: point `chainpe init` at this backend URL, then `chainpe register`.')
})
