# DoraHacks submission — Aevum Builder Challenge #1

**BUIDL name:** AgentPayGuard
**Tracks:** Confirmation of Payee · Invoice Payments
**Repo:** https://github.com/a415635511-alt/qday-agent-escrow
**Live dApp:** `dashboard/index.html` (single file, ethers v6) — also shipped as a Docker image (`Dockerfile`)
**Demo video:** `AgentPayGuard_Demo_1080p.mp4` (attached at submission time)
**Chain:** QDay Aevum Testnet, `44005`
**Asset:** tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483`

## One-line pitch

AgentPayGuard is stablecoin escrow an AI agent can use on its own: Confirmation of
Payee is checked on-chain before money moves, the agent's per-invoice and daily
spending caps live in the contract, and a human can revoke it in a single
transaction.

## What judges can verify

| Claim | How to check |
|---|---|
| Contract compiles for Shanghai | `npm run compile` (solc 0.8.29, `evmVersion: shanghai`) |
| Full lifecycle works | `npm test` — happy path + five revert paths |
| Attacks are actually blocked | `node scripts/demo_local.mjs` — prints each revert |
| On-chain on Aevum | `deployment.json` → address + tx, open in `explorer-test.qday.info` |
| UI is real | serve `dashboard/` and connect a wallet to chain 44005 |

## The problem

An autonomous agent with a stablecoin key has three ways to lose money that no
prompt can prevent: it pays an address whose owner is not who the name says, it
spends more than it should, and it keeps spending after a human said stop.

## The design

1. **Payee registry.** A supplier registers `keccak256(name)` once. Every invoice
   carries the expected name hash; `createAndFundInvoice` compares it against the
   registry and reverts with `COP_NAME_MISMATCH` on any difference. A swapped
   address can't be paid even if the agent was socially engineered.
2. **Bounded agent mandate.** `setAgentMandate(agent, maxPerInvoice, dailyLimit, expiresAt)`
   gives the agent a hard envelope; `EXCEEDS_PER_INVOICE_CAP`, `EXCEEDS_DAILY_CAP`
   and `MANDATE_INACTIVE` are contract-level reverts, not policy text.
3. **Escrow with a delivery condition.** Funds move into the contract, a supplier
   anchors `receiptHash` via `submitDeliverable`, and only then can the payer
   release. If the deadline passes with no delivery, `refundInvoice` returns the
   money. `flagDispute` freezes the invoice for review.
4. **Instant revocation.** `revokeAgentMandate` takes effect in the same block —
   no timelock for an agent to race.

## QDay-specific engineering notes

- Compiled for **Shanghai**: Aevum rejects Cancun-only opcodes (`MCOPY`, transient
  storage) with an invalid opcode — this bit us early and is fixed in `compile.mjs`.
- Reads are kept under the RPC's **1,000-block `eth_getLogs` window**; the dApp
  pages the event scan instead of asking for the whole history.
- Gas is paid in tQDAY from the Aevum faucet / Discord builder faucet.

## Honest status at submission

- Local verification is complete and reproducible (compile, Anvil end-to-end, nine-step demo).
- On-chain deployment status and the exact transaction hash are in `deployment.json`;
  the file says `not_deployed` until a receipt with status 1 exists and the address
  is read back from the chain.
- Test tokens only. No token is issued, sold or promised.
