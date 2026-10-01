import { useEffect, useState } from 'react';
import {
  Wallet,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../lib/api';

type PaymentStatus = 'pending' | 'confirmed' | 'failed' | 'expired' | 'refunded';
type ProviderName = 'stablecoin' | 'local_banking';

interface Payment {
  id: string;
  provider: ProviderName;
  status: PaymentStatus;
  amount: string;
  currency: string;
  referenceId: string;
  depositAddress?: string;
  claimedTxHash?: string;
  confirmedTxHash?: string;
  chainConfirmations?: number;
  description: string;
  expiresAt: string;
  confirmedAt?: string;
  failureReason?: string;
  createdAt: string;
}

interface ProviderStatus {
  name: ProviderName;
  ready: boolean;
}

const STATUS_STYLES: Record<PaymentStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  pending: { label: 'Pending', className: 'text-amber-400 bg-amber-500/10 border-amber-500/30', Icon: Clock },
  confirmed: { label: 'Confirmed', className: 'text-teal-400 bg-teal-500/10 border-teal-500/30', Icon: CheckCircle2 },
  failed: { label: 'Failed', className: 'text-critical-400 bg-critical-500/10 border-critical-500/30', Icon: XCircle },
  expired: { label: 'Expired', className: 'text-slate-400 bg-slate-500/10 border-slate-500/30', Icon: Clock },
  refunded: { label: 'Refunded', className: 'text-slate-400 bg-slate-500/10 border-slate-500/30', Icon: RefreshCw },
};

const PROVIDER_LABELS: Record<ProviderName, string> = {
  stablecoin: 'Stablecoin (Avalanche Fuji)',
  local_banking: 'Local banking',
};

export default function QuantumPay() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [provider, setProvider] = useState<ProviderName>('stablecoin');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('AVAX');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const [txHashDraft, setTxHashDraft] = useState<Record<string, string>>({});
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [{ data: paymentsData }, { data: providersData }] = await Promise.all([
        api.get('/payments'),
        api.get('/payments/providers'),
      ]);
      setPayments(paymentsData.payments);
      setProviders(providersData.providers);
    } catch {
      setError('Could not load payment data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const selectedProviderStatus = providers.find((p) => p.name === provider);

  async function handleCreate() {
    if (!amount.trim() || !description.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { data } = await api.post('/payments', { provider, amount: amount.trim(), currency, description: description.trim() });
      setNotice(
        data.providerReady
          ? 'Payment intent created. Send funds to the deposit address, then submit your transaction hash.'
          : `Payment intent created, but this provider isn't fully configured on this deployment: ${data.instructions}`,
      );
      setPayments((prev) => [data.payment, ...prev]);
      setAmount('');
      setDescription('');
      setShowCreate(false);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not create payment.');
    } finally {
      setCreating(false);
    }
  }

  async function handleSubmitTx(payment: Payment) {
    const txHash = txHashDraft[payment.id]?.trim();
    if (!txHash) return;
    setBusyPaymentId(payment.id);
    setError(null);
    try {
      await api.post(`/payments/${payment.id}/submit-tx`, { txHash });
      setNotice('Transaction submitted. Verifying on-chain — this can take a few blocks to confirm.');
      await handleVerify(payment.id, false);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not submit transaction.');
    } finally {
      setBusyPaymentId(null);
    }
  }

  async function handleVerify(paymentId: string, showBusy = true) {
    if (showBusy) setBusyPaymentId(paymentId);
    setError(null);
    try {
      const { data } = await api.post(`/payments/${paymentId}/verify`);
      setPayments((prev) => prev.map((p) => (p.id === paymentId ? data.payment : p)));
      if (data.payment.status === 'confirmed') {
        setNotice('Payment confirmed on-chain.');
      } else if (data.verificationResult?.failureReason === 'INSUFFICIENT_CONFIRMATIONS') {
        setNotice(`Transaction found — waiting for more confirmations (${data.verificationResult.confirmations ?? 0} so far).`);
      } else if (data.verificationResult?.failureReason) {
        setError(`Verification failed: ${data.verificationResult.failureReason.replace(/_/g, ' ').toLowerCase()}`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Verification failed.');
    } finally {
      setBusyPaymentId(null);
    }
  }

  function copyAddress(address: string) {
    navigator.clipboard.writeText(address);
    setNotice('Deposit address copied.');
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <Wallet size={20} className="text-cyan-500" /> QuantumPay
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Stablecoin-first payments, verified against real on-chain transactions — never a client-reported success.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium px-3 py-2 transition-colors"
        >
          <Plus size={15} /> New payment
        </button>
      </div>

      {!loading && providers.some((p) => !p.ready) && (
        <div className="mb-4 flex items-start gap-2 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {providers
              .filter((p) => !p.ready)
              .map((p) => PROVIDER_LABELS[p.name])
              .join(' and ')}{' '}
            {providers.filter((p) => !p.ready).length === 1 ? 'is' : 'are'} not configured on this deployment yet.
          </span>
        </div>
      )}

      {notice && (
        <div className="mb-4 text-sm text-teal-400 bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 text-sm text-critical-500 bg-critical-500/10 border border-critical-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {showCreate && (
        <div className="bg-surface border border-surface-border rounded-2xl p-5 mb-6">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderName)}
                className="w-full rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
              >
                <option value="stablecoin">Stablecoin</option>
                <option value="local_banking">Local banking</option>
              </select>
              {selectedProviderStatus && !selectedProviderStatus.ready && (
                <p className="text-xs text-amber-500 mt-1">Not configured on this deployment</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Amount</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="10.00"
                inputMode="decimal"
                className="w-full rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Currency</label>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                placeholder="AVAX"
                className="w-full rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this payment for?"
            className="w-full mb-4 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !amount.trim() || !description.trim()}
            className="flex items-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-sm font-medium px-4 py-2"
          >
            {creating && <Loader2 className="animate-spin" size={15} />}
            Create payment intent
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : payments.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-surface-border rounded-2xl p-10 text-center">
          No payments yet.
        </div>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => {
            const status = STATUS_STYLES[p.status];
            const StatusIcon = status.Icon;
            return (
              <div key={p.id} className="bg-surface border border-surface-border rounded-xl p-4">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-100 truncate">{p.description}</p>
                    <p className="text-xs text-slate-500">
                      {p.amount} {p.currency} · {PROVIDER_LABELS[p.provider]}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1 text-xs border rounded-full px-2 py-0.5 shrink-0 ${status.className}`}>
                    <StatusIcon size={11} /> {status.label}
                    {p.status === 'pending' && p.chainConfirmations !== undefined && ` (${p.chainConfirmations}/3)`}
                  </span>
                </div>

                {p.status === 'pending' && p.depositAddress && (
                  <div className="mt-3 pt-3 border-t border-surface-border/60 space-y-2">
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-midnight-900 rounded-lg px-2.5 py-1.5 text-slate-300 truncate">
                        {p.depositAddress}
                      </code>
                      <button
                        onClick={() => copyAddress(p.depositAddress!)}
                        className="text-slate-400 hover:text-cyan-400"
                        aria-label="Copy deposit address"
                      >
                        <Copy size={14} />
                      </button>
                    </div>

                    {!p.claimedTxHash ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={txHashDraft[p.id] ?? ''}
                          onChange={(e) => setTxHashDraft((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          placeholder="Paste transaction hash after sending"
                          className="flex-1 rounded-lg bg-midnight-900 border border-surface-border px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500"
                        />
                        <button
                          onClick={() => handleSubmitTx(p)}
                          disabled={busyPaymentId === p.id || !txHashDraft[p.id]?.trim()}
                          className="flex items-center gap-1 rounded-lg bg-midnight-800 hover:bg-midnight-700 disabled:opacity-60 text-slate-200 text-xs font-medium px-2.5 py-1.5"
                        >
                          {busyPaymentId === p.id && <Loader2 className="animate-spin" size={12} />}
                          Submit
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500 truncate">Tx: {p.claimedTxHash}</span>
                        <button
                          onClick={() => handleVerify(p.id)}
                          disabled={busyPaymentId === p.id}
                          className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50 shrink-0 ml-2"
                        >
                          <RefreshCw size={12} className={busyPaymentId === p.id ? 'animate-spin' : ''} /> Re-check
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {p.status === 'confirmed' && p.confirmedTxHash && (
                  <p className="text-xs text-slate-500 mt-2">
                    Confirmed on-chain · Tx: {p.confirmedTxHash} · {p.confirmedAt && new Date(p.confirmedAt).toLocaleString()}
                  </p>
                )}
                {p.failureReason && (
                  <p className="text-xs text-critical-500 mt-2">{p.failureReason.replace(/_/g, ' ').toLowerCase()}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
