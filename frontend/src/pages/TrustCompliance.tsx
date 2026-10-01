import { useEffect, useState } from 'react';
import { BadgeCheck, Search, Loader2, CheckCircle2, XCircle, Link as LinkIcon } from 'lucide-react';
import { api } from '../lib/api';

interface VaultDocSummary {
  id: string;
  name: string;
  category: string;
  hasCertificate: boolean;
  hasSignature: boolean;
}

interface VerificationResult {
  verified: boolean;
  certificateId?: string;
  documentHash?: string;
  issuedAt?: string;
  hasSignature?: boolean;
  blockchain: {
    network: string;
    transactionHash: string;
    onChainConfirmed: boolean;
    hashMatchesOnChainRecord: boolean;
  } | null;
  error?: string;
}

export default function TrustCompliance() {
  const [documents, setDocuments] = useState<VaultDocSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [lookupId, setLookupId] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<VerificationResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/vault');
        setDocuments(
          data.documents.map((d: any) => ({
            id: d.id,
            name: d.name,
            category: d.category,
            hasCertificate: d.hasCertificate,
            hasSignature: d.hasSignature,
          })),
        );
      } catch {
        // Non-fatal — the verification tool below works independently and
        // doesn't require this list to have loaded.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleVerify() {
    if (!lookupId.trim()) return;
    setLookupBusy(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      // This endpoint is intentionally public/unauthenticated on the
      // backend — anyone holding a certificate ID (e.g. from a scanned
      // QR code) can verify it without a QuantumTrust account. We still
      // call it through the same api client here for convenience.
      const { data } = await api.get(`/vault/certificates/${lookupId.trim()}/verify`);
      setLookupResult(data);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setLookupResult({ verified: false, blockchain: null, error: 'CERTIFICATE_NOT_FOUND' });
      } else {
        setLookupError('Could not reach the verification service.');
      }
    } finally {
      setLookupBusy(false);
    }
  }

  const certified = documents.filter((d) => d.hasCertificate);

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
          <BadgeCheck size={20} className="text-cyan-500" /> Trust & Compliance
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Integrity certificates issued for your documents, and a public tool to verify any certificate ID.
        </p>
      </div>

      {/* Verification tool */}
      <section className="bg-surface border border-surface-border rounded-2xl p-5 mb-6">
        <h2 className="text-sm font-medium text-slate-100 mb-3">Verify a certificate</h2>
        <div className="flex gap-2 mb-4">
          <input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            placeholder="Paste a certificate ID"
            className="flex-1 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />
          <button
            onClick={handleVerify}
            disabled={lookupBusy || !lookupId.trim()}
            className="flex items-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2"
          >
            {lookupBusy ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
            Verify
          </button>
        </div>

        {lookupError && <p className="text-sm text-critical-500">{lookupError}</p>}

        {lookupResult && (
          <div
            className={`rounded-xl border p-4 ${
              lookupResult.verified ? 'border-teal-500/30 bg-teal-500/5' : 'border-critical-500/30 bg-critical-500/5'
            }`}
          >
            <div className="flex items-center gap-2 mb-3">
              {lookupResult.verified ? (
                <CheckCircle2 size={18} className="text-teal-400" />
              ) : (
                <XCircle size={18} className="text-critical-400" />
              )}
              <span className="text-sm font-medium text-slate-100">
                {lookupResult.verified ? 'Certificate verified' : 'Certificate not found'}
              </span>
            </div>

            {lookupResult.verified && (
              <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
                <dt className="text-slate-500">Document hash</dt>
                <dd className="text-slate-300 font-mono truncate">{lookupResult.documentHash}</dd>
                <dt className="text-slate-500">Issued</dt>
                <dd className="text-slate-300">{new Date(lookupResult.issuedAt!).toLocaleString()}</dd>
                <dt className="text-slate-500">Quantum-safe signature</dt>
                <dd className="text-slate-300">{lookupResult.hasSignature ? 'Present' : 'Not signed'}</dd>
                <dt className="text-slate-500">Blockchain notarization</dt>
                <dd className="text-slate-300">
                  {lookupResult.blockchain ? (
                    <span className="flex items-center gap-1">
                      {lookupResult.blockchain.onChainConfirmed && lookupResult.blockchain.hashMatchesOnChainRecord ? (
                        <CheckCircle2 size={12} className="text-teal-400" />
                      ) : (
                        <XCircle size={12} className="text-amber-400" />
                      )}
                      {lookupResult.blockchain.network} · {lookupResult.blockchain.transactionHash.slice(0, 10)}…
                    </span>
                  ) : (
                    <span className="text-slate-500">Not notarized on-chain</span>
                  )}
                </dd>
              </dl>
            )}
          </div>
        )}
      </section>

      {/* My certificates */}
      <section>
        <h2 className="text-sm font-medium text-slate-100 mb-3">Your certificates</h2>
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : certified.length === 0 ? (
          <div className="text-sm text-slate-500 border border-dashed border-surface-border rounded-2xl p-8 text-center">
            No certificates issued yet. Generate one from a document in{' '}
            <a href="/vault" className="text-cyan-400 hover:underline">
              Smart Vault
            </a>
            .
          </div>
        ) : (
          <div className="space-y-1">
            {certified.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface px-4 py-3"
              >
                <LinkIcon size={16} className="text-teal-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200 truncate">{doc.name}</p>
                  <p className="text-xs text-slate-500">
                    {doc.category} {doc.hasSignature && '· Signed'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
