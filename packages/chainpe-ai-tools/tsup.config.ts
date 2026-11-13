import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vercel: 'src/vercel.ts',
    langchain: 'src/langchain.ts'
  },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node18',
  // Frameworks are peer deps — never bundle them.
  external: ['ai', '@langchain/core', 'zod', '@chainpeavax/sdk']
})
