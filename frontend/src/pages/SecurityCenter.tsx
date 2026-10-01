import { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Smartphone,
  Monitor,
  AlertTriangle,
  ShieldAlert,
  Info,
  XCircle,
  Loader2,
  LogOut,
  Ban,
} from 'lucide-react';
import { api } from '../lib/api';

interface SessionInfo {
  id: string;
  deviceId: string;
  ipAddress: string;
  userAgent: string;
  lastSeenAt: string;
  createdAt: string;
}

interface DeviceInfo {
  id: string;
  label: string;
  lastIp: string;
  isTrusted: boolean;
  isBlocked: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

type ThreatLevel = 'info' | 'low' | 'medium' | 'high' | 'critical';

interface SecurityEventInfo {
  id: string;
  type: string;
  threatLevel: ThreatLevel;
  reason: string;
  recommendation?: string;
  confidence: number;
  acknowledged: boolean;
  createdAt: string;
}

interface Overview {
  securityScore: number;
  mfaEnabled: boolean;
  activeSessions: SessionInfo[];
  devices: DeviceInfo[];
  recentEvents: SecurityEventInfo[];
  encryptionStatus: { clientSideAesGcm: boolean };
  pqcStatus: { mlKem768: boolean; mlDsa65: boolean };
  blockchainAuditStatus: { enabled: boolean };
  quantumGuard: {
    suspiciousLoginDetection: boolean;
    impossibleTravelDetection: boolean;
    newDeviceAlerts: boolean;
    massDownloadDetection: boolean;
    suspiciousSharingDetection: boolean;
  };
}

const THREAT_STYLES: Record<ThreatLevel, { className: string; Icon: typeof Info }> = {
  info: { className: 'text-slate-400 bg-slate-500/10 border-slate-500/30', Icon: Info },
  low: { className: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30', Icon: Info },
  medium: { className: 'text-amber-400 bg-amber-500/10 border-amber-500/30', Icon: AlertTriangle },
  high: { className: 'text-critical-400 bg-critical-500/10 border-critical-500/30', Icon: ShieldAlert },
  critical: { className: 'text-critical-500 bg-critical-500/10 border-critical-500/30', Icon: XCircle },
};

const GUARD_LABELS: Record<keyof Overview['quantumGuard'], string> = {
  suspiciousLoginDetection: 'Suspicious login detection',
  impossibleTravelDetection: 'Impossible travel detection',
  newDeviceAlerts: 'New device alerts',
  massDownloadDetection: 'Mass download detection',
  suspiciousSharingDetection: 'Suspicious sharing detection',
};

function scoreColor(score: number): string {
  if (score >= 75) return 'text-teal-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-critical-400';
}

export default function SecurityCenter() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingToggle, setSavingToggle] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/security/overview');
      setOverview(data);
    } catch {
      setError('Could not load Security Center.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function revokeSession(sessionId: string) {
    setBusyId(sessionId);
    try {
      await api.post(`/security/sessions/${sessionId}/revoke`);
      setNotice('Session revoked.');
      await load();
    } catch {
      setError('Could not revoke session.');
    } finally {
      setBusyId(null);
    }
  }

  async function blockDevice(deviceId: string) {
    setBusyId(deviceId);
    try {
      await api.post(`/security/devices/${deviceId}/block`);
      setNotice('Device blocked and its sessions revoked.');
      await load();
    } catch {
      setError('Could not block device.');
    } finally {
      setBusyId(null);
    }
  }

  async function acknowledgeEvent(eventId: string) {
    setBusyId(eventId);
    try {
      await api.post(`/security/events/${eventId}/acknowledge`);
      await load();
    } catch {
      setError('Could not acknowledge event.');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleGuardFeature(key: keyof Overview['quantumGuard'], value: boolean) {
    if (!overview) return;
    setSavingToggle(key);
    // Optimistic update, reconciled by the server response.
    setOverview({ ...overview, quantumGuard: { ...overview.quantumGuard, [key]: value } });
    try {
      const { data } = await api.patch('/security/settings', { [key]: value });
      setOverview((prev) => (prev ? { ...prev, quantumGuard: { ...prev.quantumGuard, ...data.settings } } : prev));
    } catch {
      setError('Could not update setting.');
      await load();
    } finally {
      setSavingToggle(null);
    }
  }

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!overview) return <div className="text-sm text-critical-500">{error ?? 'Could not load Security Center.'}</div>;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
          <ShieldCheck size={20} className="text-cyan-500" /> Security Center
        </h1>
        <p className="text-sm text-slate-400 mt-1">Real-time security status across your account.</p>
      </div>

      {notice && (
        <div className="text-sm text-teal-400 bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2">{notice}</div>
      )}
      {error && (
        <div className="text-sm text-critical-500 bg-critical-500/10 border border-critical-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Score + status grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-surface border border-surface-border rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Security score</p>
          <p className={`text-2xl font-display font-semibold ${scoreColor(overview.securityScore)}`}>
            {overview.securityScore}
            <span className="text-sm text-slate-500">/100</span>
          </p>
        </div>
        <div className="bg-surface border border-surface-border rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">MFA</p>
          <p className={`text-sm font-medium ${overview.mfaEnabled ? 'text-teal-400' : 'text-amber-400'}`}>
            {overview.mfaEnabled ? 'Enabled' : 'Not enabled'}
          </p>
        </div>
        <div className="bg-surface border border-surface-border rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Encryption</p>
          <p className="text-sm font-medium text-teal-400">AES-256-GCM</p>
        </div>
        <div className="bg-surface border border-surface-border rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Blockchain audit</p>
          <p className={`text-sm font-medium ${overview.blockchainAuditStatus.enabled ? 'text-teal-400' : 'text-slate-500'}`}>
            {overview.blockchainAuditStatus.enabled ? 'Enabled' : 'Not configured'}
          </p>
        </div>
      </div>

      {/* Recent events */}
      <div>
        <h2 className="text-sm font-medium text-slate-200 mb-2">Recent security events</h2>
        {overview.recentEvents.length === 0 ? (
          <p className="text-sm text-slate-500">No security events recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {overview.recentEvents.map((e) => {
              const style = THREAT_STYLES[e.threatLevel];
              const Icon = style.Icon;
              return (
                <div key={e.id} className={`flex items-start gap-3 rounded-xl border p-3 ${style.className}`}>
                  <Icon size={16} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-100">{e.reason}</p>
                    {e.recommendation && <p className="text-xs text-slate-400 mt-0.5">{e.recommendation}</p>}
                    <p className="text-xs text-slate-500 mt-1">{new Date(e.createdAt).toLocaleString()}</p>
                  </div>
                  {!e.acknowledged && (
                    <button
                      onClick={() => acknowledgeEvent(e.id)}
                      disabled={busyId === e.id}
                      className="text-xs text-slate-300 hover:text-cyan-400 shrink-0 disabled:opacity-50"
                    >
                      {busyId === e.id ? <Loader2 className="animate-spin" size={13} /> : 'Dismiss'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active sessions */}
      <div>
        <h2 className="text-sm font-medium text-slate-200 mb-2">Active sessions</h2>
        <div className="space-y-2">
          {overview.activeSessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 bg-surface border border-surface-border rounded-xl p-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-200 truncate">{s.userAgent}</p>
                <p className="text-xs text-slate-500">
                  {s.ipAddress} · last active {new Date(s.lastSeenAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => revokeSession(s.id)}
                disabled={busyId === s.id}
                className="flex items-center gap-1 text-xs text-critical-400 hover:text-critical-300 shrink-0 disabled:opacity-50"
              >
                {busyId === s.id ? <Loader2 className="animate-spin" size={13} /> : <LogOut size={13} />} Revoke
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Devices */}
      <div>
        <h2 className="text-sm font-medium text-slate-200 mb-2">Devices</h2>
        <div className="space-y-2">
          {overview.devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 bg-surface border border-surface-border rounded-xl p-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {d.isTrusted ? <Monitor size={16} className="text-slate-500 shrink-0" /> : <Smartphone size={16} className="text-slate-500 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm text-slate-200 truncate">
                    {d.label} {d.isBlocked && <span className="text-critical-400">· blocked</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {d.lastIp} · last seen {new Date(d.lastSeenAt).toLocaleString()}
                  </p>
                </div>
              </div>
              {!d.isBlocked && (
                <button
                  onClick={() => blockDevice(d.id)}
                  disabled={busyId === d.id}
                  className="flex items-center gap-1 text-xs text-critical-400 hover:text-critical-300 shrink-0 disabled:opacity-50"
                >
                  {busyId === d.id ? <Loader2 className="animate-spin" size={13} /> : <Ban size={13} />} Block
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* QuantumGuard toggles */}
      <div>
        <h2 className="text-sm font-medium text-slate-200 mb-2">QuantumGuard</h2>
        <p className="text-xs text-slate-500 mb-3">
          Rule-based detection heuristics — each one independently toggleable. Note: impossible-travel detection
          requires a geo-IP provider to be configured on the backend; it stays structurally ready but inert without
          one.
        </p>
        <div className="bg-surface border border-surface-border rounded-xl divide-y divide-surface-border/60">
          {(Object.keys(overview.quantumGuard) as Array<keyof Overview['quantumGuard']>).map((key) => (
            <div key={key} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-slate-200">{GUARD_LABELS[key]}</span>
              <button
                role="switch"
                aria-checked={overview.quantumGuard[key]}
                onClick={() => toggleGuardFeature(key, !overview.quantumGuard[key])}
                disabled={savingToggle === key}
                className={`relative w-10 h-5.5 rounded-full transition-colors disabled:opacity-50 ${
                  overview.quantumGuard[key] ? 'bg-cyan-600' : 'bg-midnight-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white transition-transform ${
                    overview.quantumGuard[key] ? 'translate-x-4' : ''
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
