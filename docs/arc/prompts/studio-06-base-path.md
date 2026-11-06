Make the ChainPe provider dashboard able to live under a path prefix. Production will be served at https://chainpe.vercel.app/dashboard. The Studio preview and dev server must keep working at /. Quick preset.

Do NOT touch contracts/, abi/, foundry.toml or remappings.txt. No contract build or deploy. Do not change API calls, auth, session, money, explorer or billing logic, or any styling. Change only the files named here.

1. vite.config.ts: read VITE_BASE_PATH from the loaded env, default '/'. Set `base` to it. Set build.outDir to 'dist/dashboard' when it is '/dashboard/', otherwise leave the default. Keep everything else, including the CSP plugin, assetsInlineLimit and manualChunks.
2. src/lib/router.tsx: const BASE = import.meta.env.BASE_URL without its trailing slash ('' at root). usePath returns the path with BASE removed, always starting with '/', and with a trailing slash removed, so /dashboard, /dashboard/ and / all give '/', and /dashboard/billing gives '/billing'.
   Link href and navigate() push BASE + to; for to === '/' use BASE or '/'. The rest of the app keeps using plain paths such as '/billing'. Export a helper `withBase(to)` for this.
3. vercel.json: keep the headers block exactly. Replace the rewrites and add one redirect:
   - redirects: source "/((?!dashboard(?:/|$)).*)", destination "https://chainpe.vercel.app/dashboard", permanent false
   - rewrites: source "/dashboard/:path*", destination "/dashboard/index.html"
4. .env.example: add VITE_BASE_PATH with a comment: empty or / for the preview, /dashboard/ for the production build.
5. src/vite-env.d.ts: add VITE_BASE_PATH if env variables are typed there.

Finish with typecheck, the money tests and two production builds passing: one default, and one with VITE_BASE_PATH=/dashboard/ that puts index.html in dist/dashboard with asset URLs starting /dashboard/assets/. List every file you changed.
