Apply exactly the one fix below to contracts/ChainPeAccounts.sol. Do not refactor, rename or change anything else in
the contract. An independent review found it (Medium).

Fix: bind payTo to the provider.
- Add the custom error `error PayToNotSender(address payTo, address sender);`
- In `_validateInput`, immediately after the existing `if (input.payTo == address(0)) revert ZeroAddress();` line, add:
  `if (input.payTo != msg.sender) revert PayToNotSender(input.payTo, msg.sender);`
- `_validateInput` is currently `pure`, and reading msg.sender makes it `view`. Change that mutability only.
- Keep the zero-address check, and keep payTo in ServiceInput, Service and all events.

Tests, in contracts/test/ChainPeAccounts.t.sol:
- Update any test that registers or updates a service with a payTo other than the caller, keeping what it checks.
- Add: registerService with another address as payTo reverts with PayToNotSender.
- Add: updateService with another address as payTo reverts with PayToNotSender, and the stored payTo is unchanged.
- Keep contracts/test/ChainPeAccounts.invariant.t.sol as it is. If it fails, stop and report rather than editing it.
Run all tests and report the totals, including that invariant file.

Then deploy the fixed contract to Arc testnet as a new deployment, with the same constructor args:
- usdc = 0x3600000000000000000000000000000000000000
- treasury = 0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a
- identityRegistry = 0x8004A818BFB912233c491871b3d84c89A494BD9e
- proPricePerPeriod = 1000000
- initialOwner = 0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a
Use the same compiler settings as before. Call no function after deploy.

Update abi/ChainPeAccounts.json and contracts/README.md (new address and tx; note that the earlier deployment
0x1fd61443d8ec25b41c4e2bd5e010109e6aefefbb is superseded). Report the new address, tx hash and deployer.
