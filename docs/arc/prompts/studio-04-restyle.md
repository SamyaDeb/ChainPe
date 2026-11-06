Apply a finished visual restyle of the ChainPe provider dashboard. The changed files were sent back in place, so they are already at their workspace paths. This is the landing page's look, reviewed
outside Studio. Keep the files exactly as they are: do not redesign, reformat or improve them. Quick preset.

Do NOT touch contracts/, abi/, foundry.toml or remappings.txt. No contract build, audit or deploy. Do not change API calls, auth, session, money, explorer or billing logic.

1. package.json was sent with four new font packages: run `bun install` so bun.lock matches. Change no other dependency.
2. Run typecheck, the money tests and a production build. Only if one of them fails, make the smallest fix that makes it pass, and name the file and the reason.
3. Confirm the built index.html still has the Content-Security-Policy meta tag and that no font is inlined as a data: URL in the built CSS.
4. Report the results, and list every file you changed yourself. If you changed none, say so.
