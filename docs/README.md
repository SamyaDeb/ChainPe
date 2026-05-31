# Example Backend APIs

This folder contains sample backend APIs for testing ChainPe provider services.

## Available APIs

### 1. Bitcoin Price API (`btc-api.mjs`)

**Port**: 3001  
**Endpoints**:
- `GET /btc` - Get Bitcoin price data
- `GET /crypto?symbol=BTC` - Get cryptocurrency price by symbol

**Usage**:
```bash
node btc-api.mjs
```

**Test**:
```bash
curl http://localhost:3001/btc
```

---

### 2. Weather API (`weather-api.mjs`)

**Port**: 3004  
**Endpoints**:
- `GET /weather?city=Tokyo` - Get current weather for a city
- `GET /forecast?city=Tokyo` - Get 5-day weather forecast

**Usage**:
```bash
node weather-api.mjs
```

**Test**:
```bash
curl "http://localhost:3004/weather?city=Tokyo"
```

---

## How to Use with ChainPe

### Step 1: Start Backend API

```bash
cd examples/
node btc-api.mjs
```

### Step 2: Register as Provider

```bash
cd ../packages/chainpe
npx chainpe init
```

Enter backend URL: `http://localhost:3001`

### Step 3: Start x402 Proxy

```bash
npx chainpe start
```

### Step 4: Test with Agent

```bash
cd ../chainpe-agent
npx chainpe-agent run "What is the Bitcoin price?"
```

---

## Creating Your Own Backend API

1. Create a new `.mjs` file in this folder
2. Choose an unused port (e.g., 3005, 3006)
3. Implement your API endpoints
4. Follow Steps 1-4 above to register with ChainPe

Example template:
```javascript
import http from "http";

const PORT = 3005;

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(200);
  res.end(JSON.stringify({ message: "Your API response" }));
});

server.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
```
