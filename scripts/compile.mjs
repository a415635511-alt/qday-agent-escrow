import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'contracts', 'AgentPayGuard.sol');
const source = fs.readFileSync(sourcePath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'AgentPayGuard.sol': { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // QDay Aevum runs the Shanghai EVM: Cancun/Prague opcodes revert as INVALID.
    evmVersion: 'shanghai',
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((e) => e.severity === 'error');
if (errors.length > 0) {
  for (const err of errors) console.error(err.formattedMessage);
  process.exit(1);
}

const outDir = path.join(root, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });

for (const name of ['MockTUSD8', 'AgentPayGuard']) {
  const c = output.contracts['AgentPayGuard.sol'][name];
  fs.writeFileSync(
    path.join(outDir, `${name}.json`),
    JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2),
  );
  console.log(`Compiled ${name}: bytecode ${c.evm.bytecode.object.length / 2} bytes`);
}
