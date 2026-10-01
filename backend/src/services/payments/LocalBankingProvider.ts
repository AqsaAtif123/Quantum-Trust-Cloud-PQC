import { PaymentProvider, CreatePaymentResult, VerifyPaymentResult } from './PaymentProvider';

/**
 * Structural placeholder for a regional/local banking payment gateway
 * (e.g. a Pakistani or other region-specific processor). This is
 * deliberately NOT a fake implementation — it implements the real
 * PaymentProvider interface so the rest of QuantumPay (routes, Payment
 * model, receipts, audit logging) works identically once a real gateway
 * is wired in, but it honestly reports itself as not ready rather than
 * pretending to process a payment.
 *
 * To make this real: pick an actual gateway (e.g. a bank's REST API),
 * add its SDK/API keys to env.ts, implement createPayment to call their
 * "create checkout session" endpoint, and implement verifyPayment to call
 * their transaction-status endpoint or verify their webhook signature —
 * never to trust a client-supplied "success" flag, same principle as the
 * stablecoin provider's on-chain verification.
 */
export class LocalBankingProvider implements PaymentProvider {
  readonly name = 'local_banking';

  isReady(): boolean {
    return false;
  }

  async createPayment(): Promise<CreatePaymentResult> {
    return {
      providerReady: false,
      instructions:
        'Local banking payments are not yet integrated with a real gateway on this deployment. ' +
        'This provider is structurally wired up (Payment model, routes, receipts) but requires ' +
        'real regional payment gateway credentials to accept a payment.',
    };
  }

  async verifyPayment(): Promise<VerifyPaymentResult> {
    return { confirmed: false, failureReason: 'PROVIDER_NOT_CONFIGURED' };
  }
}
