import * as fs from 'fs';
import * as path from 'path';
import solc from 'solc';

/**
 * Hardhat's default `compile` task downloads the solc binary from
 * binaries.soliditylang.org, which is not reachable from this build
 * environment's network allowlist. This script uses the `solc` npm
 * package (pulled from the npm registry, which IS reachable) to compile
 * directly, and writes ABI + bytecode to artifacts/ in a layout the test
 * suite reads from. Swap back to `hardhat compile` in any environment
 * where the solc binary CDN is reachable — nothing else needs to change.
 */

const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts');
const ARTIFACTS_DIR = path.join(__dirname, '..', 'artifacts-solc');

function findImports(importPath: string): { contents: string } | { error: string } {
  try {
    // Resolve node_modules imports (e.g. @openzeppelin/contracts/...)
    const resolved = require.resolve(importPath, { paths: [path.join(__dirname, '..')] });
    return { contents: fs.readFileSync(resolved, 'utf8') };
  } catch (err) {
    return { error: `File not found: ${importPath}` };
  }
}

function compileContract(fileName: string): void {
  const filePath = path.join(CONTRACTS_DIR, fileName);
  const source = fs.readFileSync(filePath, 'utf8');

  const input = {
    language: 'Solidity',
    sources: { [fileName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  if (output.errors) {
    const fatal = output.errors.filter((e: any) => e.severity === 'error');
    for (const e of output.errors) {
      // eslint-disable-next-line no-console
      console.log(e.formattedMessage);
    }
    if (fatal.length > 0) {
      throw new Error(`Compilation failed with ${fatal.length} error(s)`);
    }
  }

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  for (const contractName of Object.keys(output.contracts[fileName])) {
    const contract = output.contracts[fileName][contractName];
    const artifact = {
      contractName,
      abi: contract.abi,
      bytecode: '0x' + contract.evm.bytecode.object,
      deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
    };
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, `${contractName}.json`),
      JSON.stringify(artifact, null, 2),
    );
    // eslint-disable-next-line no-console
    console.log(`Compiled ${contractName} -> artifacts-solc/${contractName}.json`);
  }
}

compileContract('QuantumTrustAuditLog.sol');
