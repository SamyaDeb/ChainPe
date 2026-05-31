/**
 * Weather API
 * 
 * A paid API service that provides weather data for cities worldwide.
 * Uses OpenWeatherMap free API for real weather data.
 * 
 * Endpoints:
 *   GET /health              - Health check (free)
 *   GET /weather?city=...    - Get current weather for a city (paid)
 *   GET /forecast?city=...   - Get 5-day forecast (paid)
 *   GET /cities              - List popular cities (paid)
 * 
 * Price: 0.02 ALGO per request
 * 
 * Usage:
 *   1. Start this API: node weather-api.mjs
 *   2. Register with ChainPe: chainpe register
 *   3. Start x402 proxy: chainpe start
 *   4. Query via agent: chainpe-agent run "What's the weather in London?"
 */

import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;

// OpenWeatherMap API (free tier, no key needed for demo - using mock data)
// For production, get a free API key at: https://openweathermap.org/api
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || "demo";

// ============================================================================
// Mock Weather Data (fallback when no API key)
// ============================================================================

const MOCK_WEATHER = {
  london: {
    city: "London",
    country: "GB",
    temperature: 12,
    feelsLike: 10,
    humidity: 78,
    pressure: 1013,
    description: "Partly cloudy",
    windSpeed: 5.2,
    icon: "02d",
  },
  "new york": {
    city: "New York",
    country: "US",
    temperature: 18,
    feelsLike: 16,
    humidity: 65,
    pressure: 1015,
    description: "Clear sky",
    windSpeed: 3.8,
    icon: "01d",
  },
  tokyo: {
    city: "Tokyo",
    country: "JP",
    temperature: 22,
    feelsLike: 21,
    humidity: 70,
    pressure: 1012,
    description: "Light rain",
    windSpeed: 4.5,
    icon: "10d",
  },
  paris: {
    city: "Paris",
    country: "FR",
    temperature: 15,
    feelsLike: 13,
    humidity: 72,
    pressure: 1014,
    description: "Overcast clouds",
    windSpeed: 4.0,
    icon: "04d",
  },
  dubai: {
    city: "Dubai",
    country: "AE",
    temperature: 35,
    feelsLike: 38,
    humidity: 45,
    pressure: 1008,
    description: "Sunny",
    windSpeed: 6.2,
    icon: "01d",
  },
  sydney: {
    city: "Sydney",
    country: "AU",
    temperature: 24,
    feelsLike: 23,
    humidity: 68,
    pressure: 1016,
    description: "Few clouds",
    windSpeed: 5.5,
    icon: "02d",
  },
  mumbai: {
    city: "Mumbai",
    country: "IN",
    temperature: 30,
    feelsLike: 34,
    humidity: 80,
    pressure: 1009,
    description: "Humid and warm",
    windSpeed: 3.2,
    icon: "01d",
  },
  toronto: {
    city: "Toronto",
    country: "CA",
    temperature: 8,
    feelsLike: 5,
    humidity: 75,
    pressure: 1018,
    description: "Light snow",
    windSpeed: 6.8,
    icon: "13d",
  },
  singapore: {
    city: "Singapore",
    country: "SG",
    temperature: 28,
    feelsLike: 32,
    humidity: 85,
    pressure: 1010,
    description: "Tropical rain",
    windSpeed: 2.5,
    icon: "09d",
  },
  berlin: {
    city: "Berlin",
    country: "DE",
    temperature: 11,
    feelsLike: 9,
    humidity: 70,
    pressure: 1015,
    description: "Cloudy",
    windSpeed: 4.8,
    icon: "03d",
  },
};

// Popular cities list
const POPULAR_CITIES = [
  "London", "New York", "Tokyo", "Paris", "Dubai",
  "Sydney", "Mumbai", "Toronto", "Singapore", "Berlin",
  "Los Angeles", "Chicago", "Hong Kong", "Amsterdam", "Barcelona"
];

// ============================================================================
// Helper Functions
// ============================================================================

// Fetch real weather from OpenWeatherMap API
async function fetchRealWeather(city) {
  if (OPENWEATHER_API_KEY === "demo") {
    return null; // Use mock data
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${OPENWEATHER_API_KEY}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    
    return {
      city: data.name,
      country: data.sys.country,
      temperature: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      pressure: data.main.pressure,
      description: data.weather[0].description,
      windSpeed: data.wind.speed,
      icon: data.weather[0].icon,
      source: "OpenWeatherMap"
    };
  } catch (error) {
    console.error(`Failed to fetch weather for ${city}:`, error.message);
    return null;
  }
}

// Get weather data (real or mock)
async function getWeatherData(city) {
  // Try real API first
  const realData = await fetchRealWeather(city);
  if (realData) {
    return realData;
  }

  // Fallback to mock data
  const cityLower = city.toLowerCase();
  const mockData = MOCK_WEATHER[cityLower];
  
  if (mockData) {
    return {
      ...mockData,
      source: "Mock Data"
    };
  }

  // Generate dynamic mock data for unknown cities
  const temp = Math.floor(Math.random() * 30) + 5; // 5-35°C
  const conditions = [
    { desc: "Clear sky", icon: "01d" },
    { desc: "Few clouds", icon: "02d" },
    { desc: "Scattered clouds", icon: "03d" },
    { desc: "Broken clouds", icon: "04d" },
    { desc: "Light rain", icon: "10d" },
    { desc: "Thunderstorm", icon: "11d" },
  ];
  const condition = conditions[Math.floor(Math.random() * conditions.length)];

  return {
    city: city.charAt(0).toUpperCase() + city.slice(1),
    country: "XX",
    temperature: temp,
    feelsLike: temp + Math.floor(Math.random() * 5) - 2,
    humidity: Math.floor(Math.random() * 40) + 40, // 40-80%
    pressure: Math.floor(Math.random() * 30) + 1000, // 1000-1030 hPa
    description: condition.desc,
    windSpeed: (Math.random() * 10 + 1).toFixed(1),
    icon: condition.icon,
    source: "Generated Mock Data"
  };
}

// Generate 5-day forecast
function generateForecast(baseWeather) {
  const forecast = [];
  const today = new Date();
  
  for (let i = 1; i <= 5; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    
    // Generate variation from base temperature
    const tempVariation = Math.floor(Math.random() * 10) - 5;
    
    forecast.push({
      date: date.toISOString().split('T')[0],
      dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'long' }),
      temperature: baseWeather.temperature + tempVariation,
      description: baseWeather.description,
      humidity: baseWeather.humidity + Math.floor(Math.random() * 10) - 5,
      windSpeed: baseWeather.windSpeed
    });
  }
  
  return forecast;
}

// ============================================================================
// API Endpoints
// ============================================================================

// Health check (free - no payment required)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Weather API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Current weather (paid)
app.get('/weather', async (req, res) => {
  try {
    const { city } = req.query;
    
    if (!city) {
      return res.status(400).json({
        success: false,
        error: 'City parameter is required (e.g., ?city=London)'
      });
    }
    
    const weather = await getWeatherData(city);
    
    res.json({
      success: true,
      data: {
        location: {
          city: weather.city,
          country: weather.country
        },
        current: {
          temperature: weather.temperature,
          feelsLike: weather.feelsLike,
          description: weather.description,
          humidity: weather.humidity,
          pressure: weather.pressure,
          windSpeed: weather.windSpeed
        },
        timestamp: new Date().toISOString(),
        source: weather.source || "Weather Service"
      }
    });
    
  } catch (error) {
    console.error('Error fetching weather:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch weather data',
      message: error.message
    });
  }
});

// 5-day forecast (paid)
app.get('/forecast', async (req, res) => {
  try {
    const { city } = req.query;
    
    if (!city) {
      return res.status(400).json({
        success: false,
        error: 'City parameter is required (e.g., ?city=London)'
      });
    }
    
    const currentWeather = await getWeatherData(city);
    const forecast = generateForecast(currentWeather);
    
    res.json({
      success: true,
      data: {
        location: {
          city: currentWeather.city,
          country: currentWeather.country
        },
        forecast: forecast,
        generatedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error generating forecast:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate forecast',
      message: error.message
    });
  }
});

// List popular cities (paid)
app.get('/cities', (req, res) => {
  res.json({
    success: true,
    cities: POPULAR_CITIES,
    count: POPULAR_CITIES.length,
    description: "Popular cities with weather data available"
  });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                      Weather API                            ║
╠════════════════════════════════════════════════════════════╣
║  Status:   Running                                          ║
║  Port:     ${PORT}                                             ║
║  Price:    0.02 ALGO per request                            ║
╠════════════════════════════════════════════════════════════╣
║  Endpoints:                                                 ║
║    GET /health            - Health check (free)             ║
║    GET /weather?city=...  - Current weather                 ║
║    GET /forecast?city=... - 5-day forecast                  ║
║    GET /cities            - List popular cities             ║
╠════════════════════════════════════════════════════════════╣
║  Examples:                                                  ║
║    curl "http://localhost:${PORT}/weather?city=London"         ║
║    curl "http://localhost:${PORT}/forecast?city=Tokyo"         ║
║    curl "http://localhost:${PORT}/cities"                      ║
╚════════════════════════════════════════════════════════════╝

Next steps:
  1. Register service:  cd ../packages/chainpe && node dist/cli.js register
  2. Start x402 proxy:  cd ../packages/chainpe && node dist/cli.js start
  3. Test with agent:   chainpe-agent run "What's the weather in London?"
`);
});
