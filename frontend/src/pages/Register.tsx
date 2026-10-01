import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, Loader2, Info } from 'lucide-react';
import { api } from '../lib/api';
import { generatePqcIdentity } from '../lib/crypto/pqcClient';
import { bufferToBase64 } from '../lib/crypto/clientEncryption';
import { persistIdentityKeys } from '../lib/crypto/secretKeyStore';

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }

    setLoading(true);
    try {
      // Generate the user's PQC identity entirely in the browser. Only the
      // public keys are sent to the server.
      const identity = generatePqcIdentity();

      const { data } = await api.post('/auth/register', {
        email,
        password,
        displayName,
        kemPublicKey: bufferToBase64(identity.kemPublicKey),
        dsaPublicKey: bufferToBase64(identity.dsaPublicKey),
      });

      // Secret keys are encrypted at rest under a key derived from the
      // password (never sent to the server — see secretKeyStore.ts) and
      // persisted locally so they survive a page reload. This is a
      // single-factor (password) unlock path; three-part recovery
      // (server share + offline share) would layer additional unlock
      // paths on top of this, not replace it.
      await persistIdentityKeys(data.userId, password, {
        kemSecretKey: identity.kemSecretKey,
        dsaSecretKey: identity.dsaSecretKey,
      });

      navigate('/login');
    } catch (err: any) {
      setError('Could not create your account. Please check your details and try again.');
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
          <h1 className="font-display text-lg font-semibold mb-1">Create your account</h1>
          <p className="text-sm text-slate-400 mb-6">
            Your quantum-safe keys are generated on this device and never sent to us.
          </p>

          {error && (
            <div className="mb-4 text-sm text-critical-500 bg-critical-500/10 border border-critical-500/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <label className="block text-sm text-slate-300 mb-1.5" htmlFor="name">
            Full name
          </label>
          <input
            id="name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full mb-4 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />

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
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mb-2 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />
          <p className="flex items-start gap-1.5 text-xs text-slate-500 mb-6">
            <Info size={13} className="mt-0.5 shrink-0" />
            At least 12 characters. This also protects your local encryption keys, so choose something you don't reuse elsewhere.
          </p>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-sm font-medium py-2.5 transition-colors"
          >
            {loading && <Loader2 className="animate-spin" size={16} />}
            Create account
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-cyan-500 hover:text-cyan-400">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
