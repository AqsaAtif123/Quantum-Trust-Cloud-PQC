import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useKeyStore } from '../store/keyStore';
import { unlockIdentityKeys, hasLocalIdentityKeys } from '../lib/crypto/secretKeyStore';
import { base64ToBuffer } from '../lib/crypto/clientEncryption';

/** A stable per-browser fingerprint used only as a device-management signal, not an identity source. */
function getOrCreateDeviceFingerprint(): string {
  const key = 'qt_device_fp';
  let fp = window.localStorage.getItem(key);
  if (!fp) {
    fp = crypto.randomUUID();
    window.localStorage.setItem(key, fp);
  }
  return fp;
}

export default function Login() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const setKeys = useKeyStore((s) => s.setKeys);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDeviceWarning, setNewDeviceWarning] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', {
        email,
        password,
        mfaToken: needsMfa ? mfaToken : undefined,
        deviceFingerprint: getOrCreateDeviceFingerprint(),
      });
      setSession({ userId: data.userId, accessToken: data.accessToken, mfaEnabled: needsMfa });

      // Unlock the locally-stored, password-encrypted PQC secret keys for
      // this session. If this browser has never had this account's keys
      // persisted (a new device), there's nothing to unlock — that's the
      // real gap this UI surfaces honestly rather than silently swallowing:
      // encrypted files/rooms from before won't be readable on this device
      // until a proper cross-device recovery flow (three-part key
      // recovery) is completed.
      const hasKeys = await hasLocalIdentityKeys(data.userId);
      if (hasKeys) {
        const keys = await unlockIdentityKeys(data.userId, password);
        if (keys) {
          setKeys({ ...keys, kemPublicKey: base64ToBuffer(data.kemPublicKey) });
          navigate('/dashboard');
        } else {
          setNewDeviceWarning(true);
        }
      } else {
        setNewDeviceWarning(true);
      }
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (code === 'MFA_TOKEN_REQUIRED') {
        setNeedsMfa(true);
      } else if (code === 'INVALID_CREDENTIALS') {
        setError('That email or password is incorrect.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-midnight-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <ShieldCheck className="text-cyan-500" size={28} strokeWidth={2} />
          <span className="font-display text-xl font-semibold tracking-tight">QuantumTrust</span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-surface-border rounded-2xl p-8 shadow-glow"
        >
          <h1 className="font-display text-lg font-semibold mb-1">Sign in</h1>
          <p className="text-sm text-slate-400 mb-6">Zero-trust access to your encrypted files.</p>

          {error && (
            <div className="mb-4 text-sm text-critical-500 bg-critical-500/10 border border-critical-500/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {newDeviceWarning && (
            <div className="mb-4 flex items-start gap-2 text-sm text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                This device doesn't have your encryption keys yet. You're signed in, but files and messages encrypted
                on other devices won't be readable here until key recovery is set up.
              </span>
            </div>
          )}

          {newDeviceWarning ? (
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium py-2.5 transition-colors"
            >
              Continue to dashboard
            </button>
          ) : (
            <>
              {!needsMfa ? (
                <>
                  <label className="block text-sm text-slate-300 mb-1.5" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full mb-4 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                  />
                  <label className="block text-sm text-slate-300 mb-1.5" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full mb-6 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                  />
                </>
              ) : (
                <>
                  <label className="block text-sm text-slate-300 mb-1.5" htmlFor="mfa">
                    6-digit authentication code
                  </label>
                  <input
                    id="mfa"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={mfaToken}
                    onChange={(e) => setMfaToken(e.target.value)}
                    className="w-full mb-6 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 tracking-[0.3em] text-center outline-none focus:border-cyan-500"
                  />
                </>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-sm font-medium py-2.5 transition-colors"
              >
                {loading && <Loader2 className="animate-spin" size={16} />}
                {needsMfa ? 'Verify code' : 'Sign in'}
              </button>
            </>
          )}
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          New to QuantumTrust?{' '}
          <Link to="/register" className="text-cyan-500 hover:text-cyan-400">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
