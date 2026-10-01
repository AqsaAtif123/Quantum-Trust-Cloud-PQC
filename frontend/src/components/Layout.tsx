import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  FolderOpen,
  Share2,
  Users,
  Lock,
  BadgeCheck,
  Wallet,
  ShieldAlert,
  ShieldCheck,
  ScrollText,
  Bell,
  Settings,
  LogOut,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useKeyStore } from '../store/keyStore';
import { useSocket, disconnectSocket } from '../lib/socket';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/files', label: 'My Files', icon: FolderOpen },
  { to: '/shared', label: 'Shared', icon: Share2 },
  { to: '/collaboration', label: 'Collaboration', icon: Users },
  { to: '/vault', label: 'Smart Vault', icon: Lock },
  { to: '/trust', label: 'Trust & Compliance', icon: BadgeCheck },
  { to: '/pay', label: 'QuantumPay', icon: Wallet },
  { to: '/guard', label: 'QuantumGuard', icon: ShieldAlert },
  { to: '/security', label: 'Security Center', icon: ShieldCheck },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const navigate = useNavigate();
  const socket = useSocket();
  const [unreadCount, setUnreadCount] = useState(0);

  async function refreshUnreadCount() {
    try {
      const { data } = await api.get('/notifications', { params: { unreadOnly: true } });
      setUnreadCount(data.unreadCount ?? data.notifications?.length ?? 0);
    } catch {
      // Non-critical — the badge just won't update this cycle.
    }
  }

  useEffect(() => {
    refreshUnreadCount();
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const handler = () => refreshUnreadCount();
    socket.on('notification:new', handler);
    return () => {
      socket.off('notification:new', handler);
    };
  }, [socket]);

  async function handleLogout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Even if the server call fails, still clear local state so the
      // user isn't stuck "logged in" on this device.
    }
    useAuthStore.getState().clear();
    useKeyStore.getState().clear();
    disconnectSocket();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex bg-midnight-950">
      <aside className="hidden md:flex md:w-60 md:flex-col border-r border-surface-border bg-midnight-900 shrink-0">
        <div className="flex items-center gap-2 px-5 py-5">
          <ShieldCheck className="text-cyan-500" size={22} />
          <span className="font-display font-semibold tracking-tight">QuantumTrust</span>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors relative ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-raised'
                }`
              }
            >
              <Icon size={17} strokeWidth={2} />
              {label}
              {to === '/notifications' && unreadCount > 0 && (
                <span className="ml-auto bg-cyan-600 text-white text-[10px] font-medium rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="px-2 py-3 border-t border-surface-border">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-critical-400 hover:bg-surface-raised transition-colors"
          >
            <LogOut size={17} strokeWidth={2} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar — real mobile layout, not a shrunk desktop one. */}
        <header className="md:hidden flex items-center justify-between gap-2 px-4 py-3 border-b border-surface-border bg-midnight-900">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-cyan-500" size={20} />
            <span className="font-display font-semibold">QuantumTrust</span>
          </div>
          <button onClick={handleLogout} aria-label="Sign out" className="text-slate-400 hover:text-critical-400">
            <LogOut size={18} />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Mobile bottom nav for the most-used sections. */}
        <nav className="md:hidden grid grid-cols-4 border-t border-surface-border bg-midnight-900">
          {NAV_ITEMS.slice(0, 4).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 text-[11px] ${
                  isActive ? 'text-cyan-400' : 'text-slate-500'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
