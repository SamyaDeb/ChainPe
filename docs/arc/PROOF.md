# Proof of live Arc testnet activity

Every live artefact from the ChainPe port to Arc, oldest first. Times are IST, taken from the block timestamp where
there is a transaction. Chain: Arc testnet (`eip155:5042002`).

| Date (IST) | What | Tx / transfer id | Explorer |
|---|---|---|---|
| 2026-11-06 01:55 | Buyer deposit of 1.00 USDC into Gateway | `0x5c05705f9945fba7815d3511c9f717a0922dee8f534f076e4ffcbb8a8fcacb81` | [view](https://explorer.testnet.arc.io/tx/0x5c05705f9945fba7815d3511c9f717a0922dee8f534f076e4ffcbb8a8fcacb81) |
| 2026-11-06 01:55 | Paid API call, exact rail, Circle Facilitator ($0.01) | `0x11027eae23b4efd8419e7fdfae073622d6096efb0767882d30a71080df83c6c9` | [view](https://explorer.testnet.arc.io/tx/0x11027eae23b4efd8419e7fdfae073622d6096efb0767882d30a71080df83c6c9) |
| 2026-11-06 01:55 | Paid API call, Gateway rail ($0.001) | `393435a2-78e7-45c3-bfd8-9f85d7b87930` | Gateway transfer id, settled in the batch below |
| 2026-11-06 01:56 | Gateway batch settling that call | `0xccffd62c1f3dc573deb7cff643d62560043da11794da8875ce03af4951691ab6` | [view](https://explorer.testnet.arc.io/tx/0xccffd62c1f3dc573deb7cff643d62560043da11794da8875ce03af4951691ab6) |
| 2026-11-06 02:06 | Seller deposit of 0.01 USDC into Gateway | `0xa0d1d20514ad84ca5d9c80a68841763e0c6b2ec2de30f49bebf5c1a952d270ce` | [view](https://explorer.testnet.arc.io/tx/0xa0d1d20514ad84ca5d9c80a68841763e0c6b2ec2de30f49bebf5c1a952d270ce) |
| 2026-11-06 02:07 | Seller withdrawal of 0.001 USDC from Gateway (mint) | `0x0d45e8f011e835740846014329bf6c8aaab49df350a77ad0cdc62b82642652a7` | [view](https://explorer.testnet.arc.io/tx/0x0d45e8f011e835740846014329bf6c8aaab49df350a77ad0cdc62b82642652a7) |
| 2026-11-06 02:07 | Seller `withdraw --all`, 0.003 USDC (mint) | `0x0a8980435809e3cab8f664ee92a8da553fa572f709f4a89272ad57610eedf3bf` | [view](https://explorer.testnet.arc.io/tx/0x0a8980435809e3cab8f664ee92a8da553fa572f709f4a89272ad57610eedf3bf) |
