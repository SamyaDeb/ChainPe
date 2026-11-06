---
title: Provider dashboard
description: See your verified revenue, buyers, ratings and service health.
---

The [provider dashboard](https://chainpe.vercel.app/dashboard) shows each developer only their own services, revenue, buyers and ratings.

## Connect

1. Register your provider account with `chainpe register`.
2. Run `chainpe login` where your proxy runs, then restart the proxy so it starts reporting payments.
3. Open the dashboard and sign in with the same wallet.

To stop reporting, start the proxy with `--no-telemetry`. You then give up verified revenue in the dashboard.

## Verified revenue

Revenue isn't taken on trust from the proxy. It only counts events matched to a USDC transfer on Arc, or to Circle's Gateway transfer record.

Gateway payments are served before their batch lands. One that later fails is marked as failed.

## Plans

Free covers one service and the last 7 days. Pro adds full history, breakdowns and CSV export. See [plans and fees](/docs/concepts/plans-and-fees).
