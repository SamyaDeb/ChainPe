# Studio run 9: fix the navy colours in the preview

The dashboard renders correctly on the live site (https://chainpe.vercel.app/dashboard): near-black text and buttons on an off-white page.

In this workspace's preview the same screens render navy. Sampled pixels: buttons rgb(1,0,95), bands rgb(1,1,91), the large revenue figure rgb(0,1,60). Button labels are unreadable because the text is navy on navy. The page background is correct at rgb(250,250,250).

`src/index.css` and `tailwind.config.js` here match the repo, and they define these tokens as a warm near-black: `--c-ink: 0.12 0.01 60`, `--c-accent: 0.12 0.01 60`. The source contains no blue value.

Find out why the preview shows navy, and fix it so the preview matches the live site:

1. Inspect the computed styles in the running preview, and report what sets the navy colour (the sandbox, an injected stylesheet, the build, or the code).
2. Make the smallest change that fixes it. Do not redesign anything, and do not change copy, layout, routes, contracts or the API client.
3. Check the fix in the running preview: buttons near-black with readable off-white labels, and bands near-black or matching the live site.
4. List every file you changed and state the cause in one sentence.

Do not deploy anything.
