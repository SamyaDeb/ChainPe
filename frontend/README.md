# ChainPe Frontend

This folder is reserved for the ChainPe web frontend application.

## Getting Started

You can add your frontend framework of choice here:

### Option 1: React + Vite
```bash
cd frontend/
npm create vite@latest . -- --template react
```

### Option 2: Next.js
```bash
cd frontend/
npx create-next-app@latest .
```

### Option 3: React + TypeScript
```bash
cd frontend/
npm create vite@latest . -- --template react-ts
```

---

## Suggested Features

### Provider Dashboard
- Register new services
- View service analytics
- Manage pricing
- Monitor payments

### Consumer Dashboard  
- Browse available services
- View payment history
- Manage wallet
- Test API calls

### Marketplace
- Search/filter services
- Service details pages
- Real-time availability status
- Usage examples

---

## Integration with ChainPe Packages

### Using Provider SDK
```javascript
import { registerService, startProxy } from '@chainpe/sdk';
```

### Using Consumer Agent SDK
```javascript
import { ChainPeAgent } from '@chainpe/agent';
```

---

## Environment Variables

Create a `.env` file:
```
VITE_ALGORAND_NETWORK=testnet
VITE_REGISTRY_APP_ID=757478481
VITE_GROQ_API_KEY=your_key_here
```

---

Ready to build! 🚀
