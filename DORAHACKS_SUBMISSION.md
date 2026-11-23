# DoraHacks submission — Aevum Builder Challenge #1

**BUIDL name:** AgentPayGuard
**Tracks:** Confirmation of Payee · Invoice Payments
**Repo:** https://github.com/a415635511-alt/qday-agent-escrow
**Live dApp:** `dashboard/index.html` (single file, ethers v6) — also shipped as a Docker image (`Dockerfile`)
**Demo video (2:35):** https://github.com/a415635511-alt/qday-agent-escrow/releases/download/demo-v1/AgentPayGuard_Demo_1080p.mp4
**Chain:** QDay Aevum Testnet, `44005`
**Asset:** tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483`

## Live deployment

| | |
|---|---|
| Contract | `0xAFE1f520B2970728235856b8C99157184518C45a` |
| Explorer | https://explorer-test.qday.info/address/0xAFE1f520B2970728235856b8C99157184518C45a |
| Deploy tx | https://explorer-test.qday.info/tx/0x2eef54d1ac8cba333109984de653938d81f02847cf1a3240b0991de2fe9cbc95 (block 3877620) |
| Source | verified on the explorer, solc 0.8.39, shanghai, optimizer 200 |
| Settled invoice | `onchain_proof.json` — hash, block and gas for every step |

## One-line pitch

AgentPayGuard is stablecoin escrow an AI agent can use on its own: Confirmation of
Payee is checked on-chain before money moves, the agent's per-invoice and daily
spending caps live in the contract, and a human can revoke it in a single
transaction.

## What judges can verify

| Claim | How to check |
|---|---|
| Contract compiles for Shanghai | `npm run compile` (solc 0.8.39, `evmVersion: shanghai`, standard JSON kept in `artifacts/standard-input.json`) |
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

## What actually ran on Aevum

Three independent keys — treasury, AI agent, supplier — on chain 44005 with the real tUSD8:

1. Supplier registered a Confirmation-of-Payee name hash; `verifyPayee` returned `true` for the
   right name and `false` for a wrong one.
2. Treasury granted the agent 2 tUSD8 per invoice, 4 tUSD8 per day, expiry +2h.
3. Agent-funded 1.5 tUSD8 invoice into escrow (CoP matched, transferFrom succeeded).
4. Supplier submitted a deliverable hash, treasury released, **supplier balance actually rose by
   1.5 tUSD8**.
5. Refusals, from the contract itself: wrong name → `COP_NAME_MISMATCH`, 3 tUSD8 on a 2 tUSD8 cap
   → `EXCEEDS_PER_INVOICE_CAP`, after revocation → `MANDATE_INACTIVE`.

Every transaction hash, block and gas figure is in `onchain_proof.json`, all read back from the
chain rather than copied from a log.

Test tokens only. No token is issued, sold or promised.
