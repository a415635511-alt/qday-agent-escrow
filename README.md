# AgentPayGuard — programmable tUSD8 escrow that an AI agent can use safely

**Aevum Builder Challenge #1** · Tracks: *Confirmation of Payee*, *Invoice Payments* ·
QDay Aevum Testnet (chain `44005`) · tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483`

Give an autonomous agent a key and it can empty the treasury in one call, pay an
address that only *looks* like your supplier, or keep spending after you revoked
its access. AgentPayGuard keeps the agent autonomous and still bounded: the
limits, the payee check and the delivery condition all live in the contract, and
a human can cut the agent off in one transaction.

---

## What it does

| Control | Where it lives | What it prevents |
|---|---|---|
| **Confirmation of Payee** | on-chain name-hash registry | paying a swapped or impersonated vendor address |
| **Per-invoice cap** | agent mandate | one bad call draining a treasury |
| **Daily cap** | agent mandate, rolling 24 h | slow bleed across many small invoices |
| **Expiry** | agent mandate | a forgotten agent key working forever |
| **Instant revocation** | one `revokeAgentMandate` tx | an agent racing a human decision |
| **Deliverable receipt** | invoice escrow | paying before an artifact exists |
| **Deadline refund** | invoice escrow | money stuck when the supplier disappears |
| **Dispute freeze** | invoice escrow | either side moving funds while a claim is open |

## Live demo

- **dApp:** `dashboard/index.html` — single file, ethers v6, wallet connect, live
  invoice ledger. Serve it with any static server (`python -m http.server` inside
  `dashboard/`) and point the wallet at Aevum.
- **Runnable lifecycle:** `node scripts/demo_local.mjs` walks the whole flow on a
  throwaway chain and prints every transaction, including the three attack
  attempts and their revert reasons — no funds, no network needed.
- **Deployed contracts on Aevum Testnet:** see `deployment.json`.

## Quick start

```bash
npm install
npm run compile              # solc 0.8.29, evmVersion shanghai
npm test                     # Anvil end-to-end: happy path + failure paths
node scripts/demo_local.mjs  # human-readable transcript of the same run
```

Deploy to Aevum (needs testnet tQDAY for gas — free from the QDay faucet or the
Discord `/faucet` command):

```bash
DEPLOYER_PRIVATE_KEY=0x… npm run deploy:aevum
```

## How a payment flows

1. **Supplier registers** — `registerPayee(keccak256(name), keccak256(metadata))`.
   The clear-text name never goes on-chain; the hash is the identity.
2. **Treasury bounds the agent** — `setAgentMandate(agent, maxPerInvoice, dailyLimit, expiresAt)`.
3. **Agent funds an invoice** — `createAndFundInvoice(payer, payee, nameHash, amount, deadline, specHash)`.
   The contract checks the payee name hash, per-invoice cap, remaining daily cap
   and expiry **before** pulling tUSD8 into escrow. Any mismatch reverts.
4. **Supplier delivers** — `submitDeliverable(id, receiptHash)`.
5. **Release or reclaim** — `releaseInvoice(id)` pays the supplier;
   `refundInvoice(id, reason)` returns the money to the payer after the deadline;
   `flagDispute(id, evidenceHash)` freezes the invoice for review.

## Why these design choices

- **CoP is enforced by the contract, not by the UI.** An agent that was socially
  engineered off-chain still cannot pay the wrong address: the name hash travels
  with the invoice and is compared on-chain.
- **Escrow, not a direct transfer.** Supplier money is released only after a
  deliverable hash is anchored, and returns to the payer if the deadline passes.
- **Revocation is immediate and single-transaction.** No timelock an agent could
  race, no pending queue.
- **Compiled for Shanghai.** Aevum is not Cancun: `PUSH0` is fine, transient
  storage and `MCOPY` are not.

## Repository layout

```
contracts/AgentPayGuard.sol   escrow + CoP registry + agent mandates
contracts/MockTUSD8.sol       test-only 6-decimal token (local chain only)
test/escrow.test.mjs          Anvil end-to-end assertions incl. attack paths
scripts/compile.mjs           solc-js build → artifacts/
scripts/deploy_aevum.mjs      deploy to chain 44005, writes deployment.json
scripts/demo_local.mjs        narrated nine-step lifecycle on a throwaway chain
dashboard/index.html          single-file dApp (ethers v6, no build step)
docs/ARCHITECTURE.md          components, workflows, failure paths, trade-offs
```

## Tests

`npm test` runs the contract on a local Anvil chain and asserts:

| Case | Expected |
|---|---|
| Payee registered with name A, invoice claims name B | reverts `COP_NAME_MISMATCH` |
| Invoice above the per-invoice cap | reverts `EXCEEDS_PER_INVOICE_CAP` |
| Second invoice breaking the daily cap | reverts `EXCEEDS_DAILY_CAP` |
| Agent tries to spend after revocation | reverts `MANDATE_INACTIVE` |
| Deadline passes with no delivery, payer refunds | payer balance restored |

## Status and honesty notes

- Written inside the Aevum Builder Challenge build window (Nov 16 – Dec 11, 2026).
- Test tokens only; no token is issued, sold or promised.
- Anything not yet confirmed on-chain — deployment, faucet claim — is recorded in
  `deployment.json` with its real state rather than assumed.

## Third-party licences

| Dependency | Licence |
|---|---|
| ethers v6 | MIT |
| solc-js | MIT |
| Foundry Anvil (local test chain only) | MIT / Apache-2.0 |

This project is MIT licensed; see `LICENSE`.
