# Contributing to ChainPe

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/ChainPe.git`
3. Install dependencies: `npm install`
4. Copy the example env: `cp .env.example .env`

## Development Workflow

```bash
npm run dev       # Run CLI in development mode via tsx
npm run build     # Compile TypeScript with tsup
npm run typecheck # Type-check without emitting
npm run clean     # Remove dist/
```

## Code Style

- TypeScript strict mode is enabled
- All public exports must have JSDoc comments
- Use structured logging via `src/logger.ts` — never use `console.log` in library code

## Submitting Changes

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Commit with conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`
3. Open a pull request against `main`

## Reporting Issues

Please open a GitHub issue with:
- Node.js version
- Full error output
- Minimal reproduction steps
