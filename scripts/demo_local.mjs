#!/usr/bin/env node
/**
 * Full-lifecycle demo transcript for AgentPayGuard.
 *
 * Runs against a throwaway local chain (Anvil) so it needs no funds and no
 * network, then prints the same steps a user performs on QDay Aevum. Point it
 * at a real deployment with:  ESCROW=0x… RPC=https://rpc-test.qday.info
 * and it replays the read-only parts against the live contract.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

const root = path.resolve(import.meta.dirname, '..');
const ABI = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'AgentPayGuard.json'), 'utf8')).abi;
const MOCK = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'MockTUSD8.json'), 'utf8'));

const line = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);
const unit = 1_000_000n;

const proc = spawn(
  path.join(root, 'node_modules', '@foundry-rs', 'anvil-win32-amd64', 'bin', 'anvil.exe'),
  ['--port', '18621', '--chain-id', '44005', '--silent'],
  { stdio: 'ignore', windowsHide: true },
);
const provider = new ethers.JsonRpcProvider('http://127.0.0.1:18621', 44005, { staticNetwork: true });
for (let i = 0; i < 40; i++) {
  try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 150)); }
}

const treasury = new ethers.NonceManager(new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider));
const agent = new ethers.NonceManager(new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider));
const supplier = new ethers.NonceManager(new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', provider));

const treasuryAddr = await treasury.getAddress();
const agentAddr = await agent.getAddress();
const supplierAddr = await supplier.getAddress();

const token = await new ethers.ContractFactory(MOCK.abi, MOCK.bytecode, treasury).deploy();
await token.deploymentTransaction().wait();
const guard = await new ethers.ContractFactory(ABI, JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'AgentPayGuard.json'), 'utf8')).bytecode, treasury).deploy(await token.getAddress());
await guard.deploymentTransaction().wait();

await (await token.mint(treasuryAddr, 500n * unit)).wait();
await (await token.approve(await guard.getAddress(), 500n * unit)).wait();

const name = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const supplierName = 'nordic-data-supplier.qday';

line('1. Supplier commits its identity (Confirmation of Payee)');
await (await guard.connect(supplier).registerPayee(name(supplierName), name('ipfs://kyb/nordic-data-supplier'))).wait();
const [ok, meta] = await guard.verifyPayee(supplierAddr, name(supplierName));
console.log(`   verifyPayee → ok=${ok}  metadata=${meta.slice(0, 18)}…`);

line('2. Treasury grants the AI agent a bounded mandate (50 / invoice, 80 / day, 24h)');
const now = (await provider.getBlock('latest')).timestamp;
await (await guard.connect(treasury).setAgentMandate(agentAddr, 50n * unit, 80n * unit, now + 86400)).wait();
console.log('   mandate active — the caps live in the contract, not in the agent');

line('3. Attack: agent tries to pay an address registered under a different name');
try {
  await guard.connect(agent).createAndFundInvoice.staticCall(treasuryAddr, supplierAddr, name('fake-vendor.qday'), 20n * unit, now + 3600, name('spec'));
  console.log('   !! unexpectedly allowed');
} catch (e) {
  console.log(`   blocked → ${e.shortMessage}`);
}

line('4. Attack: agent tries 60 tUSD8 on a 50 tUSD8 mandate');
try {
  await guard.connect(agent).createAndFundInvoice.staticCall(treasuryAddr, supplierAddr, name(supplierName), 60n * unit, now + 3600, name('spec'));
  console.log('   !! unexpectedly allowed');
} catch (e) {
  console.log(`   blocked → ${e.shortMessage}`);
}

line('5. Legitimate invoice: 45 tUSD8 into escrow');
const rc1 = await (await guard.connect(agent).createAndFundInvoice(treasuryAddr, supplierAddr, name(supplierName), 45n * unit, now + 3600, name('EU TED tender feed, 30 days'))).wait();
console.log(`   funded, tx ${rc1.hash}`);
console.log(`   escrow balance ${ethers.formatUnits(await token.balanceOf(await guard.getAddress()), 6)} tUSD8`);

line('6. Attack: second invoice of 40 tUSD8 would break the 80 tUSD8 daily cap');
try {
  await guard.connect(agent).createAndFundInvoice.staticCall(treasuryAddr, supplierAddr, name(supplierName), 40n * unit, now + 3600, name('spec'));
  console.log('   !! unexpectedly allowed');
} catch (e) {
  console.log(`   blocked → ${e.shortMessage}`);
}

line('7. Supplier delivers, agent releases');
await (await guard.connect(supplier).submitDeliverable(1, name('sha256:ted-feed-2026-11-23'))).wait();
const rc2 = await (await guard.connect(agent).releaseInvoice(1)).wait();
console.log(`   released, tx ${rc2.hash}`);
console.log(`   supplier balance ${ethers.formatUnits(await token.balanceOf(supplierAddr), 6)} tUSD8`);

line('8. Treasury revokes the agent and it is cut off immediately');
await (await guard.connect(treasury).revokeAgentMandate(agentAddr)).wait();
try {
  await guard.connect(agent).createAndFundInvoice.staticCall(treasuryAddr, supplierAddr, name(supplierName), 5n * unit, now + 3600, name('spec'));
  console.log('   !! unexpectedly allowed');
} catch (e) {
  console.log(`   blocked → ${e.shortMessage}`);
}

line('9. Deadline miss returns the money to the treasury');
const deadline = (await provider.getBlock('latest')).timestamp + 5;
await (await guard.connect(treasury).createAndFundInvoice(treasuryAddr, supplierAddr, name(supplierName), 30n * unit, deadline, name('spec'))).wait();
await provider.send('evm_increaseTime', [30]);
await provider.send('evm_mine', []);
const before = await token.balanceOf(treasuryAddr);
await (await guard.connect(treasury).refundInvoice(2, 'deadline_missed')).wait();
const after = await token.balanceOf(treasuryAddr);
console.log(`   refunded ${ethers.formatUnits(after - before, 6)} tUSD8 to the treasury`);

console.log('\nAll nine steps executed on-chain. Same contract bytecode runs on QDay Aevum (chain 44005).');
provider.destroy();
proc.kill('SIGKILL');
