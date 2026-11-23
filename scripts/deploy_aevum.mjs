import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

const root = path.resolve(import.meta.dirname, '..');
const RPC = process.env.AEVUM_RPC || 'https://rpc-test.qday.info';
const CHAIN_ID = 44005;
const TUSD8 = process.env.TUSD8_ADDRESS || '0x456569838f1d43009A91ebA4263147Afd7233483';

function loadKey() {
  if (process.env.DEPLOYER_PRIVATE_KEY) return process.env.DEPLOYER_PRIVATE_KEY;
  const walletPath = path.resolve(root, '..', 'secrets', 'testnet_wallet.json');
  const raw = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  return raw.privateKey;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const wallet = new ethers.Wallet(loadKey(), provider);
  const bal = await provider.getBalance(wallet.address);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Aevum tQDAY balance: ${ethers.formatEther(bal)}`);
  if (bal === 0n) {
    throw new Error('Zero tQDAY balance on Aevum testnet (Chain ID 44005). Claim tQDAY at https://faucet.qday.info first.');
  }

  const art = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'AgentPayGuard.json'), 'utf8'));
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  const contract = await factory.deploy(TUSD8);
  const tx = contract.deploymentTransaction();
  console.log(`Deploy tx submitted: ${tx.hash}`);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`AgentPayGuard deployed on QDay Aevum: ${addr}`);

  const proof = {
    network: 'QDay Aevum Testnet',
    chainId: CHAIN_ID,
    rpc: RPC,
    explorer: 'https://explorer-test.qday.info',
    tUSD8: TUSD8,
    deployer: wallet.address,
    agentPayGuard: addr,
    deployTx: tx.hash,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'deployment_proof.json'), JSON.stringify(proof, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
