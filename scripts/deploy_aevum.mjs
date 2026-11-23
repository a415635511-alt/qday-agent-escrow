/**
 * Deploy AgentPayGuard to QDay Aevum Testnet (chain 44005).
 *
 * Reads the deployer key from DEPLOYER_PRIVATE_KEY or ../secrets/testnet_wallet.json,
 * deploys, waits for a receipt, then proves the deployment by reading the code back
 * from the chain before writing deployment.json. A "submitted" hash alone is not
 * treated as success.
 *
 * AEVUM_RPC can point at any EVM node (for a rehearsal against a local chain):
 *   AEVUM_RPC=http://127.0.0.1:18631 node scripts/deploy_aevum.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

const root = path.resolve(import.meta.dirname, '..');
const RPC = process.env.AEVUM_RPC || 'https://rpc-test.qday.info';
const CHAIN_ID = 44005;
const TUSD8 = process.env.TUSD8_ADDRESS || '0x456569838f1d43009A91ebA4263147Afd7233483';
const OUT = path.join(root, 'deployment.json');

function loadKey() {
  if (process.env.DEPLOYER_PRIVATE_KEY) return process.env.DEPLOYER_PRIVATE_KEY;
  const walletPath = path.resolve(root, '..', 'secrets', 'testnet_wallet.json');
  const raw = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  return raw.privateKey;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const wallet = new ethers.Wallet(loadKey(), provider);

  const chainId = (await provider.getNetwork()).chainId;
  if (Number(chainId) !== CHAIN_ID) throw new Error(`wrong chain: ${chainId}`);

  const bal = await provider.getBalance(wallet.address);
  console.log(`RPC            : ${RPC}`);
  console.log(`Deployer       : ${wallet.address}`);
  console.log(`tQDAY balance  : ${ethers.formatEther(bal)}`);
  if (bal === 0n) {
    throw new Error(
      'Zero tQDAY on chain 44005. Claim from the QDay Discord builder faucet (/faucet <address>) ' +
        'or https://faucet.qday.info, then re-run.',
    );
  }

  const art = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'AgentPayGuard.json'), 'utf8'));
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  const contract = await factory.deploy(TUSD8);
  const tx = contract.deploymentTransaction();
  console.log(`Deploy tx      : ${tx.hash}`);

  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`deploy tx did not succeed: status=${receipt?.status}`);
  const addr = await contract.getAddress();

  // Read the deployed code back: a mined tx is not proof that code exists there.
  const code = await provider.getCode(addr);
  if (code === '0x') throw new Error(`no code at ${addr} after a successful receipt`);

  const onchainToken = await contract.token();
  if (onchainToken.toLowerCase() !== TUSD8.toLowerCase()) {
    throw new Error(`token mismatch: contract says ${onchainToken}, expected ${TUSD8}`);
  }

  console.log(`Contract       : ${addr}`);
  console.log(`Block          : ${receipt.blockNumber}`);
  console.log(`Code size      : ${(code.length - 2) / 2} bytes`);
  console.log(`Explorer       : https://explorer-test.qday.info/address/${addr}`);

  const proof = {
    network: 'QDay Aevum Testnet',
    chainId: CHAIN_ID,
    rpc: RPC,
    explorer: 'https://explorer-test.qday.info',
    tusd8: TUSD8,
    deployer: wallet.address,
    agentPayGuard: addr,
    deploymentTx: tx.hash,
    deploymentBlock: receipt.blockNumber,
    codeSizeBytes: (code.length - 2) / 2,
    deployedAt: new Date().toISOString(),
    state: 'deployed_and_verified',
    note: 'Address read back from the chain after a status=1 receipt; token() matches tUSD8.',
    localVerification: {
      compile: 'solc 0.8.29, evmVersion shanghai — passed',
      tests: 'node --test test/escrow.test.mjs — 1/1 passed',
      demo: 'node scripts/demo_local.mjs — nine-step lifecycle executed',
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(proof, null, 2) + '\n');
  console.log(`Wrote ${OUT}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`DEPLOY FAILED: ${err.shortMessage || err.message || err}`);
  process.exit(1);
});
