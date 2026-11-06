One small fix in the ChainPe provider dashboard. Edit only src/components/ui/Motion.tsx. Do NOT touch contracts/, abi/, foundry.toml or remappings.txt. No contract build or deploy. Quick preset.

The count-up shows in-between figures, such as $0.009230 for a real $0.01, for 1.6 seconds whenever a screen opens. Every number on this dashboard must be the real value from the API, on every frame.

1. CountUsdc must render formatUsdc(value) directly, with no animation.
2. CountInt must render the real value directly: value.toLocaleString() for a safe non-negative integer, otherwise the value as it is.
3. Keep both exports and their props, so no other file changes. Remove useCountUp, Counted, COUNT_MS and PROGRESS_STEPS, and any import this leaves unused. Keep CharIn and prefersReducedMotion, and every other animation.

Finish with typecheck, the money tests and a production build passing. List every file you changed.
