import { PaymentProvider } from './PaymentProvider.js';
import { StablecoinProvider } from './StablecoinProvider.js';
import { LocalBankingProvider } from './LocalBankingProvider.js';
import { PaymentProviderName } from '../../models/Payment.js';

const providers: Record<PaymentProviderName, PaymentProvider> = {
  stablecoin: new StablecoinProvider(),
  local_banking: new LocalBankingProvider(),
};

export function getPaymentProvider(name: PaymentProviderName): PaymentProvider {
  return providers[name];
}

export function listAvailableProviders(): Array<{ name: PaymentProviderName; ready: boolean }> {
  return (Object.keys(providers) as PaymentProviderName[]).map((name) => ({
    name,
    ready: providers[name].isReady(),
  }));
}
