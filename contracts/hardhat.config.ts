import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const CHAIN_RPC_URL = process.env.CHAIN_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
const CHAIN_PRIVATE_KEY = process.env.CHAIN_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      // Local, ephemeral chain used for the automated test suite —
      // no real funds, no external RPC needed.
    },
    fuji: {
      url: CHAIN_RPC_URL,
      // Only attach a signer if a private key was actually supplied;
      // this lets `hardhat compile`/`test` run with no wallet configured
      // at all, and only requires CHAIN_PRIVATE_KEY for real deployment.
      accounts: CHAIN_PRIVATE_KEY ? [CHAIN_PRIVATE_KEY] : [],
      chainId: 43113,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
  },
};

export default config;
