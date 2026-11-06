Apply a finished change to the ChainPe provider dashboard: wallet connection through RainbowKit, with QR sign-in and registration from the dashboard. The changed files were sent back in place, so they are already at their workspace paths. This was built and tested outside Studio. Keep the files exactly as they are: do not redesign, reformat or improve them. Quick preset.

Do NOT touch contracts/, abi/, foundry.toml or remappings.txt. No contract build, audit or deploy. Do not change API calls, session, money, explorer or styling.

1. package.json was sent with @rainbow-me/rainbowkit, wagmi and @tanstack/react-query, plus an `overrides` entry pinning qr to 0.5.5. Run `bun install` so bun.lock matches. Change no other dependency. Keep wagmi on 2.x, because RainbowKit 2 needs it. Keep the qr pin, because qr 0.7 crashes RainbowKit's QR code with `RangeError: invalid border=0`.
2. Run typecheck, the money tests and a production build. Only if one of them fails, make the smallest fix that makes it pass, and name the file and the reason.
3. Confirm the built index.html still has the Content-Security-Policy meta tag, with script-src 'self' only and wss://relay.walletconnect.org in connect-src.
4. Confirm the preview still runs on sample data and that the sample sign-in screen renders.
5. Report the results, and list every file you changed yourself. If you changed none, say so.
