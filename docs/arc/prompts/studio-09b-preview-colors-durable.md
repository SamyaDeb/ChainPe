# Studio run 9b: make the preview colour fix survive

The last run restarted the dev server, but the preview is still navy in the browser after reloading the page and the preview pane: rgb(1,1,91). The restart did not hold, or the preview does not read from the process you restarted.

Make a fix that survives a sandbox sleep and wake, and a browser reload:

1. Find exactly what serves the preview: the process, its start command, its port, any startup script, and any Vite or Tailwind cache directory. Fetch the stylesheet the preview actually receives over that port and report whether it contains `rgb(var(--c-`.
2. Remove the stale state for good: delete Vite's cache (`node_modules/.vite`) and any stale compiled CSS, and start the server the way the sandbox starts it.
3. If a stale compiled stylesheet or an old `tailwind.config` can still be loaded, fix that at its source. A small, safe source change is allowed if it is the real cause: for example, removing a stale generated file or a duplicate config.
4. Fetch the stylesheet again and confirm it has no `rgb(var(--c-`, and `.bg-accent` is `oklch(0.12 0.01 60 / 1)`.

Do not change the design, copy, layout, routes, contracts or API client. Do not deploy. List every file you changed and the cause in one sentence.
