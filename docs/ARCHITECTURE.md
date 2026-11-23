# Architecture — AgentPayGuard

## The problem

Stablecoin rails are fast, but an autonomous agent holding a hot key is a
liability: it can pay the wrong address, drain a treasury, or keep spending
after a human revokes its access. Existing escrow contracts assume a human
clicking every step, so teams either give the agent an unlimited key or keep a
person in the loop for every invoice — both defeat the point of an agent.

AgentPayGuard keeps the agent autonomous **and** bounded: the limits live in the
contract, the payee is verified before money moves, and a human can revoke the
agent in one transaction.

## Components

```
┌──────────────────────┐      setAgentMandate      ┌────────────────────────┐
│  Treasury (human)    │ ────────────────────────▶ │                        │
│  holds tUSD8         │      revoke (1 tx)        │   AgentPayGuard.sol    │
└──────────────────────┘ ◀──────────────────────── │   (Aevum chain 44005)  │
          │ approve + fund                          │                        │
          ▼                                         │  payee registry        │
┌──────────────────────┐   createAndFundInvoice ──▶ │  agent mandates        │
│  AI agent            │ ◀── revert on any breach   │  escrowed invoices     │
│  (bounded key)       │                             │  deliverable receipts  │
└──────────────────────┘                             └────────────────────────┘
                                                               │
┌──────────────────────┐          release / refund             │
│  Supplier (payee)    │ ◀─────────────────────────────────────┘
│  delivers first      │        tUSD8 only after CoP + caps pass
└──────────────────────┘
```

| Layer | File | Responsibility |
|---|---|---|
| Registry | `contracts/AgentPayGuard.sol` (`registerPayee`) | Payee commits `keccak256(name)` + `keccak256(metadata)`. The clear-text name never goes on-chain. |
| Policy | `setAgentMandate` | Per-invoice cap, daily cap, expiry, active flag — per (treasury, agent) pair. |
| Evidence | `submitDeliverable` | Agent or supplier anchors a delivery receipt hash to the invoice. |
| Settlement | `createAndFundInvoice` / `releaseInvoice` / `refundInvoice` | Funds move into escrow, out to the payee, or back to the payer on deadline. |
| Safety valve | `flagDispute` | Freezes the invoice; neither side can move funds afterwards. |
| Client | `dashboard/index.html` | Single-file dApp, ethers v6, wallet-connect, all actions and a live ledger. |

## Workflows

**Happy path**
1. Supplier calls `registerPayee(nameHash, metadataHash)` once.
2. Treasury calls `setAgentMandate(agent, 50 tUSD8, 80 tUSD8/day, expiry)`.
3. Agent calls `createAndFundInvoice(payer, payee, nameHash, 45 tUSD8, deadline, specHash)`; the contract pulls tUSD8 from the treasury into escrow after checking CoP and both caps.
4. Supplier calls `submitDeliverable(id, receiptHash)`.
5. Agent (or the treasury) calls `releaseInvoice(id)`; tUSD8 reaches the payee.

**Failure paths (all enforced on-chain, all covered by tests)**
- Payee address registered under a different name → `COP_NAME_MISMATCH`.
- Amount above the per-invoice cap → `EXCEEDS_PER_INVOICE_CAP`.
- Amount above the remaining daily cap → `EXCEEDS_DAILY_CAP`.
- Mandate revoked or expired → `MANDATE_INACTIVE`.
- Deliverable missing when releasing → `NOT_DELIVERED`.
- Deadline passed with no delivery → `refundInvoice` returns funds to the payer.
- Disputed invoice → both `release` and `refund` revert until resolved.

## Design decisions

- **Confirmation of Payee is a contract check, not a UI warning.** The name hash
  travels with the invoice, so a swapped or typo'd address fails on-chain even if
  the agent was tricked off-chain.
- **Caps are state, not parameters of a single call.** `spentToday` resets on a
  24-hour window anchored at the mandate's `lastReset`; the agent cannot reset it.
- **Revocation is one transaction and takes effect in the same block.** No
  pending queue, no timelock an agent could race.
- **Escrow, not direct transfer.** Money reaches the supplier only after a
  deliverable hash exists; otherwise it goes back to the payer after the deadline.
- **Everything the judge can re-run.** `npm run compile && npm test` deploys the
  contracts to a throwaway Anvil chain and walks the whole lifecycle, including
  the three attack paths.

## Technology

Solidity 0.8.29 compiled for **Shanghai** (Aevum is not Cancun: `PUSH0` is fine,
transient storage and `MCOPY` are not). ethers v6 for the scripts and the dApp.
solc-js for compilation so a fresh clone needs no Foundry/Hardhat install. Anvil
only as a local test chain. tUSD8 (`0x456569838f1d43009A91ebA4263147Afd7233483`,
6 decimals) is the settlement asset on Aevum Testnet.
