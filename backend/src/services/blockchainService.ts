import { ethers } from 'ethers';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import auditContractArtifact from '../contracts/QuantumTrustAuditLog.json';

/**
 * BLOCKCHAIN AUDIT LOGGING
 * ========================
 * Records only minimal verifiable hashes/references on-chain — never file
 * content or personal data (see recordId/dataHash usage below; both are
 * keccak256 hashes computed from internal identifiers + content hashes).
 *
 * DEPLOYMENT REALITY: this service requires CHAIN_RPC_URL,
 * CHAIN_PRIVATE_KEY, and AUDIT_CONTRACT_ADDRESS to be configured (see
 * .env.example). Those require a funded Avalanche Fuji testnet wallet,
 * which this build environment does not have network access to obtain or
 * use. Rather than fake a "blockchain confirmed" response, this service
 * fails closed: if unconfigured, `isEnabled()` returns false and callers
 * must treat blockchain confirmation as unavailable, not as silently
 * successful.
 */

let cachedContract: ethers.Contract | null = null;
let initializationAttempted = false;

export enum OnChainRecordType {
  AuditEvent = 0,
  DocumentHash = 1,
  Notarization = 2,
  PaymentReference = 3,
}

function getContract(): ethers.Contract | null {
  if (initializationAttempted) return cachedContract;
  initializationAttempted = true;

  if (!env.CHAIN_RPC_URL || !env.CHAIN_PRIVATE_KEY || !env.AUDIT_CONTRACT_ADDRESS) {
    logger.warn(
      'Blockchain audit logging is not configured (CHAIN_RPC_URL / CHAIN_PRIVATE_KEY / AUDIT_CONTRACT_ADDRESS missing). ' +
        'Audit events will be recorded in MongoDB only, not on-chain, until this is configured.',
    );
    return null;
  }

  try {
    const provider = new ethers.JsonRpcProvider(env.CHAIN_RPC_URL);
    const wallet = new ethers.Wallet(env.CHAIN_PRIVATE_KEY, provider);
    cachedContract = new ethers.Contract(env.AUDIT_CONTRACT_ADDRESS, auditContractArtifact.abi, wallet);
    return cachedContract;
  } catch (err) {
    logger.error({ err }, 'Failed to initialize blockchain audit contract connection');
    return null;
  }
}

export function isBlockchainAuditEnabled(): boolean {
  return getContract() !== null;
}

export interface OnChainWriteResult {
  transactionHash: string;
  blockNumber: number;
}

function deriveRecordId(namespace: string, internalId: string): string {
  // Deterministic, collision-resistant, and reveals nothing about the
  // underlying record beyond "this specific internal ID was referenced".
  return ethers.keccak256(ethers.toUtf8Bytes(`${namespace}:${internalId}`));
}

async function writeRecord(
  method: 'recordAuditEvent' | 'recordDocumentHash' | 'recordNotarization' | 'recordPaymentReference',
  namespace: string,
  internalId: string,
  dataHashHex: string, // expects a 0x-prefixed 32-byte hex hash (e.g. SHA-256 of content, formatted as bytes32)
): Promise<OnChainWriteResult | null> {
  const contract = getContract();
  if (!contract) return null;

  const recordId = deriveRecordId(namespace, internalId);
  const tx = await contract[method](recordId, dataHashHex);
  const receipt = await tx.wait();

  logger.info({ method, recordId, txHash: receipt.hash }, 'On-chain audit record written');
  return { transactionHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export const recordAuditEventOnChain = (internalId: string, dataHashHex: string) =>
  writeRecord('recordAuditEvent', 'audit', internalId, dataHashHex);

export const recordDocumentHashOnChain = (internalId: string, dataHashHex: string) =>
  writeRecord('recordDocumentHash', 'document', internalId, dataHashHex);

export const recordNotarizationOnChain = (internalId: string, dataHashHex: string) =>
  writeRecord('recordNotarization', 'notarization', internalId, dataHashHex);

export const recordPaymentReferenceOnChain = (internalId: string, dataHashHex: string) =>
  writeRecord('recordPaymentReference', 'payment', internalId, dataHashHex);

export interface OnChainVerification {
  exists: boolean;
  recordType: OnChainRecordType;
  dataHash: string;
  recordedBy: string;
  timestamp: number;
}

export async function verifyOnChainRecord(namespace: string, internalId: string): Promise<OnChainVerification | null> {
  const contract = getContract();
  if (!contract) return null;

  const recordId = deriveRecordId(namespace, internalId);
  const [exists, recordType, dataHash, recordedBy, timestamp] = await contract.verifyRecord(recordId);
  return { exists, recordType: Number(recordType), dataHash, recordedBy, timestamp: Number(timestamp) };
}
