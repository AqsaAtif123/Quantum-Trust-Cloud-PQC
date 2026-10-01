import { useEffect, useState } from 'react';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { useSocket } from '../lib/socket';

interface NotificationItem {
  _id: string;
  type: string;
  title: string;
  message: string;
  relatedId?: string;
  isRead: boolean;
  createdAt: string;
}

export default function Notifications() {
  const socket = useSocket();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/notifications');
      setNotifications(data.notifications);
    } catch {
      setError('Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const handler = () => load();
    socket.on('notification:new', handler);
    return () => {
      socket.off('notification:new', handler);
    };
  }, [socket]);

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)));
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      // Not critical enough to surface an error for a single read-marking failure.
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await api.post('/notifications/read-all');
    } catch {
      setError('Could not mark all as read.');
    } finally {
      setMarkingAll(false);
    }
  }

  const hasUnread = notifications.some((n) => !n.isRead);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <Bell size={20} className="text-cyan-500" /> Notifications
          </h1>
          <p className="text-sm text-slate-400 mt-1">Security alerts, sharing activity, vault expiry, and more.</p>
        </div>
        {hasUnread && (
          <button
            onClick={markAllRead}
            disabled={markingAll}
            className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-cyan-400 disabled:opacity-50"
          >
            {markingAll ? <Loader2 className="animate-spin" size={13} /> : <CheckCheck size={13} />}
            Mark all read
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm text-critical-500 bg-critical-500/10 border border-critical-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : notifications.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-surface-border rounded-2xl p-10 text-center">
          No notifications yet.
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <button
              key={n._id}
              onClick={() => !n.isRead && markRead(n._id)}
              className={`w-full text-left rounded-xl border p-3.5 transition-colors ${
                n.isRead
                  ? 'bg-surface border-surface-border'
                  : 'bg-cyan-500/5 border-cyan-500/30 hover:bg-cyan-500/10'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-slate-100">{n.title}</p>
                {!n.isRead && <span className="w-2 h-2 rounded-full bg-cyan-500 mt-1.5 shrink-0" />}
              </div>
              <p className="text-xs text-slate-400 mt-1">{n.message}</p>
              <p className="text-xs text-slate-500 mt-1.5">{new Date(n.createdAt).toLocaleString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
