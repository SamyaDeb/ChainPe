/**
 * Bitcoin Price API
 * 
 * A paid API service that provides cryptocurrency prices and market data.
 * Uses free CoinGecko API for real-time crypto data.
 * 
 * Endpoints:
 *   GET /health              - Health check (free)
 *   GET /btc/price           - Get Bitcoin price (paid)
 *   GET /crypto?symbol=...   - Get any crypto price (BTC, ETH, ALGO, etc.) (paid)
 *   GET /market              - Get market overview (paid)
 *   GET /trending            - Get trending cryptos (paid)
 * 
 * Price: 0.01 ALGO per request
 * 
 * Usage:
 *   1. Start this API: node btc-api.mjs
 *   2. Register with ChainPe: chainpe register
 *   3. Start x402 proxy: chainpe start
 *   4. Query via agent: chainpe-agent run "What's the Bitcoin price?"
 */

import express from 'express';

const app = express();
const PORT = process.env.PORT || 3002;

// ============================================================================
// CoinGecko API (free, no key needed)
// ============================================================================

const COINGECKO_API = "https://api.coingecko.com/api/v3";

// Symbol to CoinGecko ID mapping
const SYMBOL_MAP = {
  BTC: "bitcoin",
  ETH: "ethereum",
  ALGO: "algorand",
  SOL: "solana",
  AVAX: "avalanche-2",
  ADA: "cardano",
  DOT: "polkadot",
  MATIC: "matic-network",
  LINK: "chainlink",
  UNI: "uniswap",
  ATOM: "cosmos",
  XRP: "ripple",
  DOGE: "dogecoin",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  XLM: "stellar",
  USDT: "tether",
  USDC: "usd-coin",
};

// Mock data fallback
const MOCK_PRICES = {
  BTC: { price: 98500, change24h: 2.5, marketCap: 1950000000000, volume24h: 45000000000 },
  ETH: { price: 3850, change24h: 1.8, marketCap: 460000000000, volume24h: 28000000000 },
  ALGO: { price: 0.35, change24h: -0.5, marketCap: 2800000000, volume24h: 85000000 },
  SOL: { price: 145, change24h: 3.2, marketCap: 68000000000, volume24h: 4200000000 },
  AVAX: { price: 42, change24h: 1.1, marketCap: 16000000000, volume24h: 850000000 },
  ADA: { price: 0.68, change24h: -1.2, marketCap: 24000000000, volume24h: 650000000 },
  DOT: { price: 8.5, change24h: 0.8, marketCap: 11000000000, volume24h: 320000000 },
  MATIC: { price: 0.95, change24h: 2.1, marketCap: 8800000000, volume24h: 480000000 },
};

// ============================================================================
// Helper Functions
// ============================================================================

// Fetch real crypto data from CoinGecko
async function fetchCoinGeckoPrice(coinId) {
  try {
    const url = `${COINGECKO_API}/simple/price?ids=${coinId}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data[coinId]) {
      return null;
    }
    
    return {
      price: data[coinId].usd,
      change24h: data[coinId].usd_24h_change || 0,
      marketCap: data[coinId].usd_market_cap || 0,
      volume24h: data[coinId].usd_24h_vol || 0,
      source: "CoinGecko"
    };
  } catch (error) {
    console.error(`Failed to fetch ${coinId} from CoinGecko:`, error.message);
    return null;
  }
}

// Get crypto price (real or mock)
async function getCryptoPrice(symbol) {
  const symbolUpper = symbol.toUpperCase();
  const coinId = SYMBOL_MAP[symbolUpper];
  
  if (!coinId) {
    return null;
  }
  
  // Try real API first
  const realData = await fetchCoinGeckoPrice(coinId);
  if (realData) {
    return {
      symbol: symbolUpper,
      name: coinId.charAt(0).toUpperCase() + coinId.slice(1).replace(/-/g, ' '),
      ...realData
    };
  }
  
  // Fallback to mock data
  const mockData = MOCK_PRICES[symbolUpper];
  if (mockData) {
    return {
      symbol: symbolUpper,
      name: symbolUpper,
      ...mockData,
      source: "Mock Data"
    };
  }
  
  return null;
}

// Fetch market overview
async function getMarketOverview() {
  try {
    // Get top 10 cryptos by market cap
    const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return data.map(coin => ({
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h || 0,
      marketCap: coin.market_cap,
      volume24h: coin.total_volume,
      rank: coin.market_cap_rank
    }));
  } catch (error) {
    console.error('Failed to fetch market overview:', error.message);
    
    // Return mock data for top cryptos
    return Object.entries(MOCK_PRICES).map(([symbol, data], index) => ({
      symbol,
      name: symbol,
      ...data,
      rank: index + 1,
      source: "Mock Data"
    }));
  }
}

// Fetch trending cryptos
async function getTrending() {
  try {
    const url = `${COINGECKO_API}/search/trending`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return data.coins.slice(0, 7).map(item => ({
      symbol: item.item.symbol,
      name: item.item.name,
      marketCapRank: item.item.market_cap_rank,
      priceChange24h: item.item.data?.price_change_percentage_24h?.usd || 0,
      score: item.item.score
    }));
  } catch (error) {
    console.error('Failed to fetch trending:', error.message);
    
    // Return mock trending
    return [
      { symbol: "BTC", name: "Bitcoin", marketCapRank: 1, priceChange24h: 2.5, score: 0 },
      { symbol: "ETH", name: "Ethereum", marketCapRank: 2, priceChange24h: 1.8, score: 1 },
      { symbol: "SOL", name: "Solana", marketCapRank: 5, priceChange24h: 3.2, score: 2 },
    ];
  }
}

// ============================================================================
// API Endpoints
// ============================================================================

// Health check (free - no payment required)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Bitcoin Price API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Bitcoin price endpoint (paid)
app.get('/btc/price', async (req, res) => {
  try {
    const btcData = await getCryptoPrice('BTC');
    
    if (!btcData) {
      return res.status(503).json({
        success: false,
        error: 'Unable to fetch Bitcoin price'
      });
    }
    
    res.json({
      success: true,
      data: {
        symbol: "BTC",
        name: "Bitcoin",
        price: btcData.price,
        priceFormatted: `$${btcData.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        change24h: btcData.change24h,
        marketCap: btcData.marketCap,
        volume24h: btcData.volume24h,
        timestamp: new Date().toISOString(),
        source: btcData.source || "Live Data"
      }
    });
    
  } catch (error) {
    console.error('Error fetching BTC price:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Bitcoin price',
      message: error.message
    });
  }
});

// Generic crypto price endpoint (paid)
app.get('/crypto', async (req, res) => {
  try {
    const { symbol } = req.query;
    
    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'Symbol parameter is required (e.g., ?symbol=BTC)',
        supportedSymbols: Object.keys(SYMBOL_MAP)
      });
    }
    
    const cryptoData = await getCryptoPrice(symbol);
    
    if (!cryptoData) {
      return res.status(404).json({
        success: false,
        error: `Cryptocurrency '${symbol.toUpperCase()}' not found`,
        supportedSymbols: Object.keys(SYMBOL_MAP)
      });
    }
    
    res.json({
      success: true,
      data: {
        symbol: cryptoData.symbol,
        name: cryptoData.name,
        price: cryptoData.price,
        priceFormatted: `$${cryptoData.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: cryptoData.price < 1 ? 6 : 2 })}`,
        change24h: cryptoData.change24h,
        marketCap: cryptoData.marketCap,
        volume24h: cryptoData.volume24h,
        timestamp: new Date().toISOString(),
        source: cryptoData.source || "Live Data"
      }
    });
    
  } catch (error) {
    console.error('Error fetching crypto price:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cryptocurrency price',
      message: error.message
    });
  }
});

// Market overview (paid)
app.get('/market', async (req, res) => {
  try {
    const marketData = await getMarketOverview();
    
    res.json({
      success: true,
      data: {
        topCryptos: marketData,
        count: marketData.length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error fetching market overview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch market overview',
      message: error.message
    });
  }
});

// Trending cryptos (paid)
app.get('/trending', async (req, res) => {
  try {
    const trendingData = await getTrending();
    
    res.json({
      success: true,
      data: {
        trending: trendingData,
        count: trendingData.length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error fetching trending cryptos:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trending cryptos',
      message: error.message
    });
  }
});

// List supported symbols (paid)
app.get('/symbols', (req, res) => {
  res.json({
    success: true,
    supported: Object.keys(SYMBOL_MAP),
    count: Object.keys(SYMBOL_MAP).length,
    description: "Supported cryptocurrency symbols"
  });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                  Bitcoin Price API                          ║
╠════════════════════════════════════════════════════════════╣
║  Status:   Running                                          ║
║  Port:     ${PORT}                                             ║
║  Price:    0.01 ALGO per request                            ║
╠════════════════════════════════════════════════════════════╣
║  Endpoints:                                                 ║
║    GET /health            - Health check (free)             ║
║    GET /btc/price         - Bitcoin price                   ║
║    GET /crypto?symbol=... - Any crypto price                ║
║    GET /market            - Market overview (top 10)        ║
║    GET /trending          - Trending cryptos                ║
║    GET /symbols           - List supported symbols          ║
╠════════════════════════════════════════════════════════════╣
║  Supported: BTC, ETH, ALGO, SOL, AVAX, ADA, DOT, MATIC     ║
║             LINK, UNI, ATOM, XRP, DOGE, LTC, BCH, XLM       ║
╠════════════════════════════════════════════════════════════╣
║  Examples:                                                  ║
║    curl "http://localhost:${PORT}/btc/price"                   ║
║    curl "http://localhost:${PORT}/crypto?symbol=ALGO"          ║
║    curl "http://localhost:${PORT}/market"                      ║
╚════════════════════════════════════════════════════════════╝

Next steps:
  1. Register service:  cd ../packages/chainpe && node dist/cli.js register
  2. Start x402 proxy:  cd ../packages/chainpe && node dist/cli.js start
  3. Test with agent:   chainpe-agent run "What's the Bitcoin price?"
`);
});
