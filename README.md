# AgentPayGuard — Programmable tUSD8 Escrow & Confirmation of Payee on QDay Aevum

Built for **Aevum Builder Challenge #1** (QDay Aevum Testnet, Chain ID `44005`, `tUSD8` `0x456569838f1d43009A91ebA4263147Afd7233483`).

## Problem
Autonomous AI agents and SMEs paying vendors in stablecoins face three real failure modes:
1. **Misdirected payouts** (wrong address / impersonated vendor — no Confirmation of Payee check).
2. **Unbounded agent wallets** (a buggy or prompt-injected agent can drain an entire treasury in one call).
3. **No atomic delivery-vs-payment** (funds sent before verifiable artifact delivery, with no automatic timeout refund).

## Solution (`contracts/AgentPayGuard.sol`)
- **Confirmation of Payee (CoP) Registry**: Payees register `keccak256(canonicalName)` + metadata hash on-chain. Every `createAndFundInvoice` reverts (`COP_NAME_MISMATCH`) if the expected payee name hash does not match the recipient address.
- **Bounded AI Agent Mandates**: Principals grant an AI agent a strict `maxPerInvoice`, rolling 24-hour `dailyLimit`, and `expiresAt`.
- **1-Tx Instant Revocation**: `revokeAgentMandate(agent)` immediately blocks both new invoice funding and fund release by that agent.
- **Verifiable Deliverable Escrow**: Payee submits `receiptHash` (`submitDeliverable`), principal/active agent releases `tUSD8` (`releaseInvoice`), or principal reclaims 100% after `deadline` (`refundInvoice`).
- **Dispute Freeze**: Either party can freeze an active invoice (`flagDispute`) with an on-chain evidence hash.

## Quick Start
```bash
npm install
npm run compile
npm test
```

## Deploy to QDay Aevum Testnet (Chain ID 44005)
```bash
# Requires testnet tQDAY from https://faucet.qday.info
DEPLOYER_PRIVATE_KEY=0x... npm run deploy:aevum
```

## Status
- Local Solidity compilation (`solc 0.8.29`) and Anvil end-to-end integration tests: **verified**.
- QDay Aevum Testnet live deployment: **pending testnet `tQDAY` faucet claim** (faucet requires a recipient address with mainnet history).
