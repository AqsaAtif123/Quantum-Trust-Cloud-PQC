import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, User, Lock, ShieldCheck, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useKeyStore } from '../store/keyStore';
import { persistIdentityKeys, unlockIdentityKeys } from '../lib/crypto/secretKeyStore';

interface Me {
  userId: string;
  email: string;
  displayName: string;
  mfaEnabled: boolean;
  securityScore: number;
}

export default function Settings() {
  const userId = useAuthStore((s) => s.userId);
  const unlocked = useKeyStore((s) => s.unlocked);

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Profile
  const [displayName, setDisplayName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // MFA
  const [mfaSetup, setMfaSetup] = useState<{ otpAuthUrl: string; secret: string } | null>(null);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [disableToken, setDisableToken] = useState('');

  async function loadMe() {
    setLoading(true);
    try {
      const { data } = await api.get('/auth/me');
      setMe(data);
      setDisplayName(data.displayName);
    } catch {
      setError('Could not load your account.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMe();
  }, []);

  async function handleSaveProfile() {
    if (!displayName.trim()) return;
    setSavingProfile(true);
    setError(null);
    try {
      await api.patch('/auth/profile', { displayName: displayName.trim() });
      setNotice('Profile updated.');
      await loadMe();
    } catch {
      setError('Could not update your profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    if (!userId || newPassword.length < 12) {
      setError('New password must be at least 12 characters.');
      return;
    }
    setChangingPassword(true);
    setError(null);
    try {
      // Verify the current password can actually unlock the local PQC
      // keys BEFORE changing anything server-side. If it can't (e.g. this
      // device's local record is out of sync), changing the server
      // password anyway would leave the local key store permanently
      // unrecoverable with a password that no longer unlocks it — better
      // to fail here than silently orphan the local keys.
      const keys = unlocked ? await unlockIdentityKeys(userId, currentPassword) : null;

      await api.post('/auth/change-password', { currentPassword, newPassword });

      // Re-encrypt the local key record under the new password so it
      // still unlocks correctly on next login. This MUST happen after the
      // server accepts the new password, using the keys we already
      // recovered above — never re-deriving or regenerating keys here.
      if (keys) {
        await persistIdentityKeys(userId, newPassword, keys);
      }

      setNotice(
        keys
          ? 'Password changed. Your other sessions have been signed out.'
          : 'Password changed, but your local encryption keys could not be re-locked with the new password on this device — you may need to re-unlock on next login.',
      );
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      const code = err?.response?.data?.error;
      setError(code === 'INCORRECT_CURRENT_PASSWORD' ? 'Your current password is incorrect.' : 'Could not change your password.');
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleStartMfaEnroll() {
    setMfaBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/mfa/enroll');
      setMfaSetup(data);
    } catch {
      setError('Could not start MFA setup.');
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleConfirmMfa() {
    if (mfaToken.length !== 6) return;
    setMfaBusy(true);
    setError(null);
    try {
      await api.post('/auth/mfa/confirm', { token: mfaToken });
      setNotice('Two-factor authentication enabled.');
      setMfaSetup(null);
      setMfaToken('');
      await loadMe();
    } catch {
      setError('Invalid code. Please try again.');
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleDisableMfa() {
    if (disableToken.length !== 6) return;
    setMfaBusy(true);
    setError(null);
    try {
      await api.post('/auth/mfa/disable', { token: disableToken });
      setNotice('Two-factor authentication disabled.');
      setDisableToken('');
      await loadMe();
    } catch {
      setError('Invalid code. Two-factor authentication was not disabled.');
    } finally {
      setMfaBusy(false);
    }
  }

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
          <SettingsIcon size={20} className="text-cyan-500" /> Settings
        </h1>
      </div>

      {notice && (
        <div className="mb-4 flex items-center gap-2 text-sm text-teal-400 bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2">
          <CheckCircle2 size={15} /> {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 text-sm text-critical-500 bg-critical-500/10 border border-critical-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Profile */}
      <section className="bg-surface border border-surface-border rounded-2xl p-5 mb-5">
        <h2 className="text-sm font-medium text-slate-100 flex items-center gap-2 mb-4">
          <User size={16} className="text-cyan-500" /> Profile
        </h2>
        <label className="block text-xs text-slate-400 mb-1.5">Email</label>
        <input
          value={me?.email ?? ''}
          disabled
          className="w-full mb-4 rounded-lg bg-midnight-950 border border-surface-border px-3 py-2 text-sm text-slate-500"
        />
        <label className="block text-xs text-slate-400 mb-1.5">Display name</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full mb-4 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
        />
        <button
          onClick={handleSaveProfile}
          disabled={savingProfile || displayName.trim() === me?.displayName}
          className="flex items-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium px-3 py-2"
        >
          {savingProfile && <Loader2 className="animate-spin" size={14} />}
          Save
        </button>
      </section>

      {/* Password */}
      <section className="bg-surface border border-surface-border rounded-2xl p-5 mb-5">
        <h2 className="text-sm font-medium text-slate-100 flex items-center gap-2 mb-4">
          <Lock size={16} className="text-cyan-500" /> Password
        </h2>
        {!unlocked && (
          <div className="flex items-start gap-2 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-4">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Your encryption keys aren't unlocked on this device. You can still change your password, but your local
            keys won't be re-locked with the new one here — do that from a device where they are unlocked.
          </div>
        )}
        <label className="block text-xs text-slate-400 mb-1.5">Current password</label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full mb-4 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
        />
        <label className="block text-xs text-slate-400 mb-1.5">New password (min. 12 characters)</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full mb-4 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
        />
        <button
          onClick={handleChangePassword}
          disabled={changingPassword || !currentPassword || newPassword.length < 12}
          className="flex items-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium px-3 py-2"
        >
          {changingPassword && <Loader2 className="animate-spin" size={14} />}
          Change password
        </button>
        <p className="text-xs text-slate-500 mt-2">Changing your password signs you out of every other session.</p>
      </section>

      {/* MFA */}
      <section className="bg-surface border border-surface-border rounded-2xl p-5">
        <h2 className="text-sm font-medium text-slate-100 flex items-center gap-2 mb-4">
          <ShieldCheck size={16} className="text-cyan-500" /> Two-factor authentication
        </h2>

        {me?.mfaEnabled ? (
          <>
            <p className="text-xs text-teal-400 mb-4">Two-factor authentication is enabled on your account.</p>
            <label className="block text-xs text-slate-400 mb-1.5">Enter a code to disable it</label>
            <div className="flex gap-2">
              <input
                value={disableToken}
                onChange={(e) => setDisableToken(e.target.value)}
                maxLength={6}
                inputMode="numeric"
                className="flex-1 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 tracking-[0.3em] text-center outline-none focus:border-cyan-500"
              />
              <button
                onClick={handleDisableMfa}
                disabled={mfaBusy || disableToken.length !== 6}
                className="rounded-lg bg-critical-600 hover:bg-critical-500 disabled:opacity-50 text-white text-sm font-medium px-3 py-2"
              >
                Disable
              </button>
            </div>
          </>
        ) : mfaSetup ? (
          <>
            <p className="text-xs text-slate-400 mb-3">
              Add this to your authenticator app, then enter a code to confirm.
            </p>
            <div className="mb-4 rounded-lg bg-midnight-950 border border-surface-border px-3 py-2 text-xs text-slate-300 break-all font-mono">
              {mfaSetup.secret}
            </div>
            <div className="flex gap-2">
              <input
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value)}
                maxLength={6}
                inputMode="numeric"
                placeholder="6-digit code"
                className="flex-1 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 tracking-[0.3em] text-center outline-none focus:border-cyan-500"
              />
              <button
                onClick={handleConfirmMfa}
                disabled={mfaBusy || mfaToken.length !== 6}
                className="rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium px-3 py-2"
              >
                Confirm
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={handleStartMfaEnroll}
            disabled={mfaBusy}
            className="flex items-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium px-3 py-2"
          >
            {mfaBusy && <Loader2 className="animate-spin" size={14} />}
            Set up two-factor authentication
          </button>
        )}
      </section>
    </div>
  );
}
