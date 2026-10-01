import { ethers } from 'ethers';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { PaymentProvider, CreatePaymentResult, VerifyPaymentResult } from './PaymentProvider';

const MIN_CONFIRMATIONS = 3;

// Minimal ERC20 ABI — just the Transfer event, which is all verification needs.
const ERC20_TRANSFER_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)'];

/**
 * Verifies payment by actually reading the blockchain — never by trusting
 * a "payment succeeded" message from the frontend. Two verification modes:
 *
 * 1. ERC20 stablecoin transfer (if STABLECOIN_CONTRACT_ADDRESS is set):
 *    reads the transaction receipt's Transfer event logs and confirms the
 *    `to` address, `value`, and token contract all match what was expected.
 * 2. Native-currency transfer fallback (no stablecoin contract configured):
 *    confirms the transaction's `to` and `value` directly. This is a real,
 *    honest fallback — not a "fake" payment path — for environments where
 *    a specific stablecoin token hasn't been deployed/configured yet.
 *
 * FAILS CLOSED: if CHAIN_RPC_URL or a receiving address isn't configured,
 * isReady() returns false and createPayment/verifyPayment refuse to
 * pretend otherwise.
 */
export class StablecoinProvider implements PaymentProvider {
  readonly name = 'stablecoin';
  private provider: ethers.JsonRpcProvider | null = null;

  private getProvider(): ethers.JsonRpcProvider | null {
    if (this.provider) return this.provider;
    if (!env.CHAIN_RPC_URL) return null;
    this.provider = new ethers.JsonRpcProvider(env.CHAIN_RPC_URL);
    return this.provider;
  }

  isReady(): boolean {
    return !!env.CHAIN_RPC_URL && !!env.PAYMENT_RECEIVING_ADDRESS;
  }

  async createPayment(params: { amount: string; currency: string; referenceId: string }): Promise<CreatePaymentResult> {
    if (!this.isReady()) {
      return {
        providerReady: false,
        instructions:
          'Stablecoin payments are not configured on this deployment (missing CHAIN_RPC_URL or PAYMENT_RECEIVING_ADDRESS). ' +
          'No deposit address can be issued until these are set.',
      };
    }

    return {
      depositAddress: env.PAYMENT_RECEIVING_ADDRESS,
      providerReady: true,
      instructions: env.STABLECOIN_CONTRACT_ADDRESS
        ? `Send exactly ${params.amount} ${params.currency} (ERC20 token at ${env.STABLECOIN_CONTRACT_ADDRESS}) to ${env.PAYMENT_RECEIVING_ADDRESS} on Avalanche Fuji Testnet, then submit the transaction hash.`
        : `Send exactly ${params.amount} AVAX to ${env.PAYMENT_RECEIVING_ADDRESS} on Avalanche Fuji Testnet, then submit the transaction hash. ` +
          `(No stablecoin token contract is configured, so this deployment verifies native-currency transfers instead.)`,
    };
  }

  async verifyPayment(params: {
    referenceId: string;
    claimedTxHash?: string;
    depositAddress?: string;
    amount: string;
  }): Promise<VerifyPaymentResult> {
    if (!this.isReady()) {
      return { confirmed: false, failureReason: 'PROVIDER_NOT_CONFIGURED' };
    }
    if (!params.claimedTxHash) {
      return { confirmed: false, failureReason: 'NO_TRANSACTION_HASH_SUBMITTED' };
    }

    const provider = this.getProvider()!;

    try {
      const receipt = await provider.getTransactionReceipt(params.claimedTxHash);
      if (!receipt) {
        return { confirmed: false, failureReason: 'TRANSACTION_NOT_FOUND_OR_NOT_MINED' };
      }
      if (receipt.status !== 1) {
        return { confirmed: false, failureReason: 'TRANSACTION_REVERTED' };
      }

      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber + 1;

      if (env.STABLECOIN_CONTRACT_ADDRESS) {
        const verified = verifyErc20TransferInReceipt(
          receipt,
          env.STABLECOIN_CONTRACT_ADDRESS,
          params.depositAddress!,
          params.amount,
        );
        if (!verified) {
          return { confirmed: false, confirmations, failureReason: 'TRANSFER_AMOUNT_OR_RECIPIENT_MISMATCH' };
        }
      } else {
        const tx = await provider.getTransaction(params.claimedTxHash);
        if (!tx || tx.to?.toLowerCase() !== params.depositAddress?.toLowerCase()) {
          return { confirmed: false, confirmations, failureReason: 'RECIPIENT_MISMATCH' };
        }
        const expectedWei = ethers.parseEther(params.amount);
        if (tx.value !== expectedWei) {
          return { confirmed: false, confirmations, failureReason: 'AMOUNT_MISMATCH' };
        }
      }

      if (confirmations < MIN_CONFIRMATIONS) {
        return { confirmed: false, confirmations, failureReason: 'INSUFFICIENT_CONFIRMATIONS' };
      }

      return { confirmed: true, confirmations };
    } catch (err) {
      logger.error({ err, referenceId: params.referenceId }, 'Stablecoin payment verification failed');
      return { confirmed: false, failureReason: 'VERIFICATION_ERROR' };
    }
  }

}

/**
 * Standalone (and therefore independently testable) ERC20 Transfer-event
 * verification: scans a transaction receipt's logs for a Transfer event
 * from the given token contract that matches the expected recipient and
 * amount. Exported separately from the class so it can be unit tested
 * with a hand-built receipt object, without needing a live RPC connection.
 */
export function verifyErc20TransferInReceipt(
  receipt: ethers.TransactionReceipt | { logs: ReadonlyArray<{ address: string; topics: readonly string[]; data: string }> },
  tokenContractAddress: string,
  expectedTo: string,
  expectedAmount: string,
): boolean {
  const iface = new ethers.Interface(ERC20_TRANSFER_ABI);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== tokenContractAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;
      const to = parsed.args.to as string;
      const value = parsed.args.value as bigint;
      // Assumes 6 decimals (standard for USDC-style stablecoins). A
      // production deployment should read decimals() from the token
      // contract rather than assuming, if supporting multiple tokens.
      const expectedValue = ethers.parseUnits(expectedAmount, 6);
      if (to.toLowerCase() === expectedTo.toLowerCase() && value === expectedValue) {
        return true;
      }
    } catch {
      continue; // not a Transfer event log, skip
    }
  }
  return false;
}
