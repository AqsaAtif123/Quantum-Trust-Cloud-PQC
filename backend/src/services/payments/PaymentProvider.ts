export interface CreatePaymentResult {
  /** Where the payer needs to send funds, or provider-specific instructions. */
  depositAddress?: string;
  /** True if this provider is actually usable right now (has real credentials configured). */
  providerReady: boolean;
  instructions: string;
}

export interface VerifyPaymentResult {
  confirmed: boolean;
  confirmations?: number;
  failureReason?: string;
}

/**
 * QuantumPay's provider abstraction. Every provider must FAIL CLOSED when
 * it isn't actually configured with real credentials — never simulate a
 * successful payment. See StablecoinProvider and LocalBankingProvider for
 * what "not configured" looks like for each.
 */
export interface PaymentProvider {
  readonly name: string;
  isReady(): boolean;
  createPayment(params: { amount: string; currency: string; referenceId: string }): Promise<CreatePaymentResult>;
  verifyPayment(params: { referenceId: string; claimedTxHash?: string; depositAddress?: string; amount: string }): Promise<VerifyPaymentResult>;
}
