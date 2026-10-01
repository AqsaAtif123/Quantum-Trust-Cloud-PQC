import { useEffect, useState } from 'react';
import { ScrollText, Loader2, ChevronDown, ShieldAlert, Info, AlertTriangle, ShieldOff } from 'lucide-react';
import { api } from '../lib/api';

type ThreatLevel = 'info' | 'low' | 'medium' | 'high' | 'critical';

interface AuditEvent {
  id: string;
  type: string;
  threatLevel: ThreatLevel;
  reason: string;
  evidence: Record<string, unknown>;
  confidence: number;
  acknowledged: boolean;
  createdAt: string;
}

const LEVEL_STYLES: Record<ThreatLevel, { className: string; Icon: typeof Info }> = {
  info: { className: 'text-slate-400 border-slate-600/40 bg-slate-500/5', Icon: Info },
  low: { className: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/5', Icon: Info },
  medium: { className: 'text-amber-400 border-amber-500/30 bg-amber-500/5', Icon: AlertTriangle },
  high: { className: 'text-orange-400 border-orange-500/30 bg-orange-500/5', Icon: ShieldAlert },
  critical: { className: 'text-critical-400 border-critical-500/30 bg-critical-500/5', Icon: ShieldOff },
};

const TYPE_LABELS: Record<string, string> = {
  login_success: 'Successful login',
  login_failure: 'Failed login attempt',
  mfa_challenge: 'MFA challenge',
  new_device: 'New device seen',
  impossible_travel: 'Impossible travel',
  suspicious_download: 'Suspicious download',
  mass_file_access: 'Mass file access',
  suspicious_sharing: 'Suspicious sharing activity',
  permission_change: 'Permission change',
  policy_change: 'Security policy change',
};

export default function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockchainAuditEnabled, setBlockchainAuditEnabled] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('');

  async function loadPage(before?: string) {
    const params: Record<string, string> = { limit: '50' };
    if (before) params.before = before;
    if (typeFilter) params.type = typeFilter;

    const { data } = await api.get('/security/events', { params });
    setBlockchainAuditEnabled(data.blockchainAuditEnabled);
    return data.events as AuditEvent[];
  }

  async function loadInitial() {
    setLoading(true);
    setError(null);
    try {
      const first = await loadPage();
      setEvents(first);
      setHasMore(first.length === 50);
    } catch {
      setError('Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  async function handleLoadMore() {
    if (events.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = events[events.length - 1].createdAt;
      const next = await loadPage(oldest);
      setEvents((prev) => [...prev, ...next]);
      setHasMore(next.length === 50);
    } catch {
      setError('Could not load more events.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <ScrollText size={20} className="text-cyan-500" /> Audit Log
          </h1>
          <p className="text-sm text-slate-400 mt-1">Every recorded security-relevant event on your account.</p>
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-xs text-slate-300 outline-none focus:border-cyan-500"
        >
          <option value="">All event types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-slate-500 mb-5">
        {blockchainAuditEnabled
          ? 'File and vault actions are additionally notarized on Avalanche Fuji Testnet — verify any specific file or certificate from its own page.'
          : 'Blockchain notarization is not configured on this deployment, so these events are recorded in the database only, not on-chain.'}
      </p>

      {error && (
        <div className="mb-4 text-sm text-critical-500 bg-critical-500/10 border border-critical-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-surface-border rounded-2xl p-10 text-center">
          No events recorded yet.
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {events.map((event) => {
              const style = LEVEL_STYLES[event.threatLevel];
              const Icon = style.Icon;
              return (
                <div
                  key={event.id}
                  className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${style.className}`}
                >
                  <Icon size={16} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-slate-200 font-medium">
                        {TYPE_LABELS[event.type] ?? event.type}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{event.reason}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full flex items-center justify-center gap-2 mt-4 rounded-lg border border-surface-border bg-surface hover:bg-surface-raised text-sm text-slate-300 py-2.5 disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="animate-spin" size={14} /> : <ChevronDown size={14} />}
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}
