/**
 * Real on-chain lifecycle on QDay Aevum testnet, using the deployed AgentPayGuard
 * and the real tUSD8. Three independent keys play treasury, AI agent and supplier,
 * so the agent's spending caps are enforced against a different signer than the payer.
 *
 *   node scripts/onchain_demo.mjs
 *
 * Writes onchain_proof.json with every tx hash, block number, gas used and the
 * explorer link, then reads each receipt back from the chain before declaring success.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ethers } from 'ethers';

const root = path.resolve(import.meta.dirname, '..');
const RPC = process.env.AEVUM_RPC || 'https://rpc-test.qday.info';
const CHAIN_ID = 44005;
const EXPLORER = 'https://explorer-test.qday.info';
const TUSD8 = process.env.TUSD8_ADDRESS || '0x456569838f1d43009A91ebA4263147Afd7233483';

const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployment.json'), 'utf8'));
if (deployment.state !== 'deployed_and_verified') throw new Error('no verified deployment');
const GUARD = deployment.agentPayGuard;

const artefact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'AgentPayGuard.json'), 'utf8'));
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
];

const keysFile = path.resolve(root, '..', 'secrets', 'qday_demo_keys.json');
function loadKeys() {
  const treasury = JSON.parse(
    fs.readFileSync(path.resolve(root, '..', 'secrets', 'testnet_wallet.json'), 'utf8'),
  ).privateKey;
  if (fs.existsSync(keysFile)) {
    const k = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
    return { treasury, agent: k.agent, supplier: k.supplier };
  }
  const fresh = { agent: ethers.Wallet.createRandom().privateKey, supplier: ethers.Wallet.createRandom().privateKey };
  fs.writeFileSync(keysFile, JSON.stringify(fresh, null, 2));
  return { treasury, ...fresh };
}

const sha = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const usd = (v) => ethers.parseUnits(String(v), 6);
const steps = [];
const receipts = [];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const keys = loadKeys();
  const T = new ethers.Wallet(keys.treasury, provider);
  const A = new ethers.Wallet(keys.agent, provider);
  const S = new ethers.Wallet(keys.supplier, provider);

  const guard = new ethers.Contract(GUARD, artefact.abi, T);
  const tusd8 = new ethers.Contract(TUSD8, ERC20_ABI, T);

  const log = (m) => { steps.push(m); console.log(m); };

  log(`guard      ${GUARD}`);
  log(`treasury   ${T.address}`);
  log(`agent      ${A.address}`);
  log(`supplier   ${S.address}`);

  // --- fund the two extra roles with gas from the treasury
  for (const role of [A, S]) {
    const bal = await provider.getBalance(role.address);
    if (bal < ethers.parseEther('0.05')) {
      const tx = await T.sendTransaction({ to: role.address, value: ethers.parseEther('0.05') });
      const r = await tx.wait();
      receipts.push({ step: `fund gas → ${role.address}`, hash: tx.hash, block: r.blockNumber, gasUsed: r.gasUsed.toString() });
      log(`gas sent to ${role.address}  tx ${tx.hash}`);
    }
  }

  const nameText = 'EU Data Labs d.o.o. — supplier handle';
  const nameHash = sha(nameText);

  // --- 1. supplier registers its canonical name (Confirmation of Payee)
  const regTx = await guard.connect(S).registerPayee(nameHash, sha('ipfs://qday-demo/kyb.json'));
  const regRc = await regTx.wait();
  receipts.push({ step: 'registerPayee (supplier)', hash: regTx.hash, block: regRc.blockNumber, gasUsed: regRc.gasUsed.toString() });
  log(`registerPayee  tx ${regTx.hash}  block ${regRc.blockNumber}`);

  const [okMatch, meta] = await guard.verifyPayee(S.address, nameHash);
  const [okMismatch] = await guard.verifyPayee(S.address, sha('someone else'));
  if (!okMatch || okMismatch) throw new Error('CoP registry read-back failed');
  log(`verifyPayee    match=${okMatch} mismatch=${okMismatch} meta=${meta.slice(0, 12)}…`);

  // --- 2. treasury approves tUSD8 and grants the agent a bounded mandate
  const appTx = await tusd8.connect(T).approve(GUARD, usd(5));
  receipts.push({ step: 'tUSD8 approve (treasury → guard)', hash: appTx.hash, block: (await appTx.wait()).blockNumber });
  log(`approve        tx ${appTx.hash}`);

  const now = (await provider.getBlock('latest')).timestamp;
  const manTx = await guard.connect(T).setAgentMandate(A.address, usd(2), usd(4), now + 7200);
  const manRc = await manTx.wait();
  receipts.push({ step: 'setAgentMandate 2 / 4 tUSD8, 2h', hash: manTx.hash, block: manRc.blockNumber, gasUsed: manRc.gasUsed.toString() });
  log(`mandate        tx ${manTx.hash}  block ${manRc.blockNumber}`);

  // --- 3. the agent tries two things it is not allowed to do (simulated, no gas spent)
  const specHash = sha('Deliver TED tender feed v1, 30 days, CSV');
  for (const [label, args, expect] of [
    ['wrong payee name', [T.address, S.address, sha('attacker'), usd(1), now + 3600, specHash], 'COP_NAME_MISMATCH'],
    ['over per-invoice cap', [T.address, S.address, nameHash, usd(3), now + 3600, specHash], 'EXCEEDS_PER_INVOICE_CAP'],
  ]) {
    let reason = 'NO REVERT';
    try {
      await guard.connect(A).createAndFundInvoice.staticCall(...args);
    } catch (e) {
      reason = (e.shortMessage || e.message || '').replace(/^execution reverted:\s*/i, '');
    }
    const good = reason.includes(expect);
    log(`blocked (${label}): ${reason}${good ? '' : '  ← UNEXPECTED'}`);
    if (!good) throw new Error(`expected ${expect}, got ${reason}`);
    receipts.push({ step: `revert check: ${label}`, result: 'reverted', reason });
  }

  // --- 4. the agent funds a legitimate 1.5 tUSD8 invoice inside its caps
  const invTx = await guard.connect(A).createAndFundInvoice(T.address, S.address, nameHash, usd(1.5), now + 3600, specHash);
  const invRc = await invTx.wait();
  receipts.push({ step: 'createAndFundInvoice 1.5 tUSD8 (agent)', hash: invTx.hash, block: invRc.blockNumber, gasUsed: invRc.gasUsed.toString() });
  log(`invoice #1     tx ${invTx.hash}  block ${invRc.blockNumber}`);

  const inv = await guard.invoices(1);
  if (Number(inv.status) !== 1) throw new Error(`invoice status ${inv.status}, expected FUNDED`);
  log(`invoice #1     status FUNDED  amount ${ethers.formatUnits(inv.amount, 6)} tUSD8  agent ${inv.agent}`);
  if (inv.agent.toLowerCase() !== A.address.toLowerCase()) throw new Error('agent not recorded');

  const escrowBal = await tusd8.balanceOf(GUARD);
  log(`escrow holds   ${ethers.formatUnits(escrowBal, 6)} tUSD8`);

  // --- 5. supplier submits a deliverable receipt, treasury releases
  const art = JSON.stringify({ dataset: 'ted-tenders-2026-11-23', rows: 10, sha256: crypto.randomBytes(16).toString('hex') });
  const receiptHash = ethers.keccak256(ethers.toUtf8Bytes(art));
  const delTx = await guard.connect(S).submitDeliverable(1, receiptHash);
  const delRc = await delTx.wait();
  receipts.push({ step: 'submitDeliverable (supplier)', hash: delTx.hash, block: delRc.blockNumber, gasUsed: delRc.gasUsed.toString() });
  log(`deliverable    tx ${delTx.hash}  block ${delRc.blockNumber}`);

  const relTx = await guard.connect(T).releaseInvoice(1);
  const relRc = await relTx.wait();
  receipts.push({ step: 'releaseInvoice (treasury)', hash: relTx.hash, block: relRc.blockNumber, gasUsed: relRc.gasUsed.toString() });
  log(`release        tx ${relTx.hash}  block ${relRc.blockNumber}`);

  const sBal = await tusd8.balanceOf(S.address);
  log(`supplier got   ${ethers.formatUnits(sBal, 6)} tUSD8`);

  // --- 6. revoke the agent, prove it is cut off
  const revTx = await guard.connect(T).revokeAgentMandate(A.address);
  const revRc = await revTx.wait();
  receipts.push({ step: 'revokeAgentMandate (treasury)', hash: revTx.hash, block: revRc.blockNumber, gasUsed: revRc.gasUsed.toString() });
  log(`revoke         tx ${revTx.hash}  block ${revRc.blockNumber}`);

  let afterRevoke = 'NO REVERT';
  try {
    await guard.connect(A).createAndFundInvoice.staticCall(T.address, S.address, nameHash, usd(1), now + 3600, specHash);
  } catch (e) {
    afterRevoke = (e.shortMessage || e.message || '').replace(/^execution reverted:\s*/i, '');
  }
  const cut = afterRevoke.includes('MANDATE_INACTIVE');
  log(`after revoke   ${afterRevoke}${cut ? '' : '  ← UNEXPECTED'}`);
  if (!cut) throw new Error(`expected MANDATE_INACTIVE after revoke, got ${afterRevoke}`);
  receipts.push({ step: 'revert check: agent after revocation', result: 'reverted', reason: afterRevoke });

  // --- 7. read every receipt back from the chain before writing the proof
  for (const r of receipts.filter((x) => x.hash)) {
    const rc = await provider.getTransactionReceipt(r.hash);
    if (!rc || rc.status !== 1) throw new Error(`receipt not successful for ${r.hash}`);
    r.explorer = `${EXPLORER}/tx/${r.hash}`;
  }

  const proof = {
    network: 'QDay Aevum Testnet',
    chainId: CHAIN_ID,
    explorer: EXPLORER,
    guard: GUARD,
    tusd8: TUSD8,
    roles: { treasury: T.address, agent: A.address, supplier: S.address },
    invoices: [{ id: 1, amount: '1.5', status: 'RELEASED', agent: A.address, payee: S.address }],
    steps,
    receipts,
    executedAt: new Date().toISOString(),
    verification: {
      everyReceiptStatus: 1,
      copRegistryReadBack: 'match=true, mismatch=false',
      escrowFunded: true,
      supplierBalance: ethers.formatUnits(sBal, 6) + ' tUSD8',
      capsEnforcedOffSigner: true,
      revocationEnforced: true,
    },
  };
  fs.writeFileSync(path.join(root, 'onchain_proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(`\nwrote onchain_proof.json — ${receipts.length} recorded steps`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`ONCHAIN DEMO FAILED: ${e.shortMessage || e.message || e}`);
  process.exit(1);
});
