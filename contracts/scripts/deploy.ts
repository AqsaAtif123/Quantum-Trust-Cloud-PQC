import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Run with: npm run deploy:fuji
 * Requires CHAIN_RPC_URL and CHAIN_PRIVATE_KEY set in ../.env (the private
 * key must belong to a wallet funded with Fuji AVAX from a faucet —
 * https://core.app/tools/testnet-faucet/ — never a mainnet key).
 *
 * This has NOT been run against the real Fuji network from this build
 * environment (no network access to Avalanche RPC endpoints here). It has
 * only been exercised against Hardhat's local in-memory network via the
 * test suite. Please run this yourself once you have a funded testnet
 * wallet and report back the deployed address / any errors.
 */
async function main(): Promise<void> {
  const artifactPath = path.join(__dirname, '..', 'artifacts-solc', 'QuantumTrustAuditLog.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  const [deployer] = await ethers.getSigners();
  console.log('Deploying with account:', await deployer.getAddress());
  console.log('Account balance:', ethers.formatEther(await ethers.provider.getBalance(await deployer.getAddress())), 'AVAX');

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy(await deployer.getAddress());
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('QuantumTrustAuditLog deployed to:', address);
  console.log('Set AUDIT_CONTRACT_ADDRESS=' + address + ' in your .env');

  const deploymentRecord = {
    network: 'fuji',
    address,
    deployer: await deployer.getAddress(),
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(__dirname, '..', 'deployments.fuji.json'),
    JSON.stringify(deploymentRecord, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
