import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

const root = path.resolve(import.meta.dirname, '..');
const anvilBin = path.join(root, 'node_modules', '@foundry-rs', 'anvil-win32-amd64', 'bin', 'anvil.exe');

async function startAnvil(port) {
  const proc = spawn(anvilBin, ['--port', String(port), '--chain-id', '44005', '--silent'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const rpc = `http://127.0.0.1:${port}`;
  const provider = new ethers.JsonRpcProvider(rpc, 44005, { staticNetwork: true });
  for (let i = 0; i < 40; i += 1) {
    try {
      await provider.getBlockNumber();
      return { proc, provider };
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  proc.kill();
  throw new Error('Anvil failed to start');
}

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8'));
}

// A revert must be asserted with staticCall: sending a tx that fails gas
// estimation can leave the promise unsettled and hang the test runner.
async function expectRevert(factory, pattern) {
  try {
    await factory();
    assert.fail(`expected revert ${pattern} but the call succeeded`);
  } catch (err) {
    assert.match(err.shortMessage || err.message || String(err), pattern);
  }
}

test('AgentPayGuard end-to-end: CoP, agent caps, deliverable receipt, release, instant revocation & expiry refund', async () => {
  const { proc, provider } = await startAnvil(18549);
  try {
    const payer = new ethers.NonceManager(new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider));
    const agent = new ethers.NonceManager(new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider));
    const payee = new ethers.NonceManager(new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', provider));
    const payerAddr = await payer.getAddress();
    const agentAddr = await agent.getAddress();
    const payeeAddr = await payee.getAddress();

    const mockArt = loadArtifact('MockTUSD8');
    const guardArt = loadArtifact('AgentPayGuard');

    const token = await new ethers.ContractFactory(mockArt.abi, mockArt.bytecode, payer).deploy();
    await token.deploymentTransaction().wait();
    const tokenAddr = await token.getAddress();

    const guard = await new ethers.ContractFactory(guardArt.abi, guardArt.bytecode, payer).deploy(tokenAddr);
    await guard.deploymentTransaction().wait();
    const guardAddr = await guard.getAddress();

    // Mint 1,000 tUSD8 (6 decimals) to payer and approve guard
    const unit = 1_000_000n;
    await (await token.mint(payerAddr, 1000n * unit)).wait();
    await (await token.approve(guardAddr, 1000n * unit)).wait();

    // 1. Payee registers canonical Confirmation of Payee (CoP) identity
    const canonicalName = ethers.keccak256(ethers.toUtf8Bytes('EU-Data-Labs.qday'));
    const wrongName = ethers.keccak256(ethers.toUtf8Bytes('Phishing-Vendor.qday'));
    const metaHash = ethers.keccak256(ethers.toUtf8Bytes('ipfs://cop-verification-v1'));
    await (await guard.connect(payee).registerPayee(canonicalName, metaHash)).wait();

    const [okMatch] = await guard.verifyPayee(payeeAddr, canonicalName);
    const [okMismatch] = await guard.verifyPayee(payeeAddr, wrongName);
    assert.equal(okMatch, true);
    assert.equal(okMismatch, false);

    // 2. Payer grants bounded mandate to AI agent: max 50 tUSD8/invoice, 80 tUSD8/day
    const now = (await provider.getBlock('latest')).timestamp;
    await (await guard.connect(payer).setAgentMandate(agentAddr, 50n * unit, 80n * unit, now + 3600)).wait();

    const specHash = ethers.keccak256(ethers.toUtf8Bytes('Deliver EU TED tender feed v1'));

    // 3. CoP mismatch MUST revert
    await expectRevert(
      () => guard.connect(agent).createAndFundInvoice.staticCall(payerAddr, payeeAddr, wrongName, 25n * unit, now + 600, specHash),
      /COP_NAME_MISMATCH/,
    );

    // 4. Exceeding per-invoice cap (60 > 50) MUST revert
    await expectRevert(
      () => guard.connect(agent).createAndFundInvoice.staticCall(payerAddr, payeeAddr, canonicalName, 60n * unit, now + 600, specHash),
      /EXCEEDS_PER_INVOICE_CAP/,
    );

    // 5. Agent creates & funds valid 45 tUSD8 invoice
    await (
      await guard.connect(agent).createAndFundInvoice(payerAddr, payeeAddr, canonicalName, 45n * unit, now + 600, specHash)
    ).wait();
    assert.equal(await token.balanceOf(guardAddr), 45n * unit);

    // 6. Second invoice of 40 tUSD8 exceeds 80 tUSD8 daily cap (45 + 40 = 85 > 80) -> MUST revert
    await expectRevert(
      () => guard.connect(agent).createAndFundInvoice.staticCall(payerAddr, payeeAddr, canonicalName, 40n * unit, now + 600, specHash),
      /EXCEEDS_DAILY_CAP/,
    );

    // 7. Payee submits verifiable deliverable receipt & agent releases funds
    const receiptHash = ethers.keccak256(ethers.toUtf8Bytes('sha256:dataset-ted-2026-11-23'));
    await (await guard.connect(payee).submitDeliverable(1, receiptHash)).wait();
    await (await guard.connect(agent).releaseInvoice(1)).wait();

    assert.equal(await token.balanceOf(payeeAddr), 45n * unit);
    const inv1 = await guard.invoices(1);
    assert.equal(Number(inv1.status), 3); // RELEASED

    // 8. Instant revocation cuts off agent immediately
    await (await guard.connect(payer).revokeAgentMandate(agentAddr)).wait();
    await expectRevert(
      () => guard.connect(agent).createAndFundInvoice.staticCall(payerAddr, payeeAddr, canonicalName, 10n * unit, now + 600, specHash),
      /MANDATE_INACTIVE/,
    );

    // 9. Payer creates invoice #2 directly, lets deadline pass, and reclaims full refund
    const shortDeadline = (await provider.getBlock('latest')).timestamp + 5;
    await (
      await guard.connect(payer).createAndFundInvoice(payerAddr, payeeAddr, canonicalName, 30n * unit, shortDeadline, specHash)
    ).wait();
    const balBeforeRefund = await token.balanceOf(payerAddr);
    await provider.send('evm_increaseTime', [10]);
    await provider.send('evm_mine', []);
    await (await guard.connect(payer).refundInvoice(2, 'deadline_missed')).wait();
    assert.equal(await token.balanceOf(payerAddr), balBeforeRefund + 30n * unit);
  } finally {
    provider.destroy();
    proc.kill('SIGKILL');
  }
});
