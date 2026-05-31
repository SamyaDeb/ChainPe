# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, send an email to **sammodeb28@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations

You will receive a response within 48 hours. If the issue is confirmed, a fix
will be released as quickly as possible and you will be credited in the release
notes unless you prefer to remain anonymous.

## Private Key Safety

ChainPe requires a facilitator private key (`CHAINPE_FACILITATOR_KEY`) for
on-chain settlement. **Never commit this key to version control.** Use `.env`
(which is in `.gitignore`) or a secrets manager.

The facilitator wallet only needs enough AVAX to pay gas fees — keep balances
minimal to limit exposure.
