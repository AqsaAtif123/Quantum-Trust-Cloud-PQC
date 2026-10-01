import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Plus, Send, UserPlus, Loader2, Lock, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useSocket } from '../lib/socket';
import { useKeyStore } from '../store/keyStore';
import { base64ToBuffer } from '../lib/crypto/clientEncryption';
import {
  generateRoomKey,
  wrapRoomKeyForMember,
  unwrapRoomKey,
  encryptChatMessage,
  decryptChatMessage,
  EncryptedChatMessage,
} from '../lib/crypto/roomEncryption';

interface Room {
  _id: string;
  name: string;
  currentKeyEpoch: number;
}

interface ChatMessage {
  _id: string;
  senderId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyEpoch: number;
  createdAt: string;
  plaintext?: string; // filled in client-side after decryption; never sent to/from the server
}

export default function Collaboration() {
  const socket = useSocket();
  const kemSecretKey = useKeyStore((s) => s.kemSecretKey);
  const kemPublicKey = useKeyStore((s) => s.kemPublicKey);
  const unlocked = useKeyStore((s) => s.unlocked);

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [roomKey, setRoomKey] = useState<CryptoKey | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'contributor' | 'viewer'>('contributor');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get('/rooms')
      .then(({ data }) => setRooms(data.rooms))
      .catch(() => setError('Could not load your rooms.'))
      .finally(() => setLoadingRooms(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function openRoom(room: Room) {
    setActiveRoom(room);
    setMessages([]);
    setRoomKey(null);
    setError(null);

    if (!kemSecretKey) {
      setError('Your encryption keys are not unlocked on this device — messages cannot be decrypted here.');
      return;
    }

    try {
      const { data: keyData } = await api.get(`/rooms/${room._id}/my-key`);
      const key = await unwrapRoomKey(keyData.wrappedRoomKey, kemSecretKey);
      setRoomKey(key);

      const { data: msgData } = await api.get(`/rooms/${room._id}/messages`);
      const decrypted: ChatMessage[] = await Promise.all(
        msgData.messages.map(async (m: ChatMessage) => {
          try {
            const plaintext = await decryptChatMessage(
              { ciphertext: m.ciphertext, iv: m.iv, authTag: m.authTag } as EncryptedChatMessage,
              key,
            );
            return { ...m, plaintext };
          } catch {
            return { ...m, plaintext: '[unable to decrypt — sent under a different key epoch]' };
          }
        }),
      );
      setMessages(decrypted);

      socket?.emit('room:join', room._id);
    } catch {
      setError("Could not unlock this room's key. It may have been rekeyed since your last visit.");
    }
  }

  useEffect(() => {
    if (!socket || !activeRoom || !roomKey) return undefined;

    async function onMessage(payload: any) {
      if (payload.roomId !== activeRoom!._id) return;
      let plaintext: string;
      try {
        plaintext = await decryptChatMessage(payload, roomKey!);
      } catch {
        plaintext = '[unable to decrypt — sent under a different key epoch]';
      }
      setMessages((prev) => [
        ...prev,
        {
          _id: payload.messageId,
          senderId: payload.senderId,
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          authTag: payload.authTag,
          keyEpoch: payload.keyEpoch,
          createdAt: payload.createdAt,
          plaintext,
        },
      ]);
    }

    socket.on('room:message', onMessage);
    return () => {
      socket.off('room:message', onMessage);
    };
  }, [socket, activeRoom, roomKey]);

  async function handleCreateRoom() {
    if (!newRoomName.trim() || !kemPublicKey) return;
    setCreating(true);
    try {
      const key = await generateRoomKey();
      const ownerWrappedRoomKey = await wrapRoomKeyForMember(key, kemPublicKey);
      const { data } = await api.post('/rooms', { name: newRoomName.trim(), ownerWrappedRoomKey });
      setRooms((prev) => [...prev, data.room]);
      setNewRoomName('');
      setShowCreateForm(false);
    } catch {
      setError('Could not create the room.');
    } finally {
      setCreating(false);
    }
  }

  async function handleInvite() {
    if (!activeRoom || !inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    try {
      const { data: user } = await api.get('/users/lookup', { params: { email: inviteEmail.trim() } });
      if (!roomKey) throw new Error('room key not available');
      const wrappedRoomKey = await wrapRoomKeyForMember(roomKey, base64ToBuffer(user.kemPublicKey));
      await api.post(`/rooms/${activeRoom._id}/invite`, {
        userId: user.userId,
        role: inviteRole,
        wrappedRoomKey,
      });
      setInviteEmail('');
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setError('No user found with that email, or they have not set up encryption keys yet.');
      } else {
        setError('Could not send the invite.');
      }
    } finally {
      setInviting(false);
    }
  }

  async function handleSend() {
    if (!draft.trim() || !activeRoom || !roomKey) return;
    const text = draft;
    setDraft('');
    try {
      const encrypted = await encryptChatMessage(text, roomKey);
      await api.post(`/rooms/${activeRoom._id}/messages`, { ...encrypted, keyEpoch: activeRoom.currentKeyEpoch });
      // The server echoes this back over the socket to everyone in the
      // room, including us, so we don't optimistically append here — that
      // would risk a duplicate if the socket event arrives too.
    } catch {
      setError('Message failed to send.');
      setDraft(text);
    }
  }

  const canUseChat = useMemo(() => unlocked && !!kemPublicKey, [unlocked, kemPublicKey]);

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6">
      <div className="w-72 border-r border-surface-border flex flex-col">
        <div className="p-4 flex items-center justify-between border-b border-surface-border">
          <h2 className="font-display text-sm font-semibold text-slate-200">Rooms</h2>
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            className="text-slate-400 hover:text-cyan-500 transition-colors"
            aria-label="Create room"
          >
            <Plus size={18} />
          </button>
        </div>

        {showCreateForm && (
          <div className="p-3 border-b border-surface-border bg-midnight-900/50">
            <input
              autoFocus
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateRoom()}
              placeholder="Room name"
              className="w-full rounded-lg bg-midnight-900 border border-surface-border px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-500 mb-2"
            />
            <button
              onClick={handleCreateRoom}
              disabled={creating || !newRoomName.trim()}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-xs font-medium py-1.5"
            >
              {creating && <Loader2 className="animate-spin" size={14} />}
              Create
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loadingRooms ? (
            <div className="p-4 text-sm text-slate-500">Loading…</div>
          ) : rooms.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No rooms yet.</div>
          ) : (
            rooms.map((room) => (
              <button
                key={room._id}
                onClick={() => openRoom(room)}
                className={`w-full text-left px-4 py-3 border-b border-surface-border/50 hover:bg-midnight-900/50 transition-colors flex items-center gap-2 ${
                  activeRoom?._id === room._id ? 'bg-midnight-900' : ''
                }`}
              >
                <MessageSquare size={15} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-200 truncate">{room.name}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {!canUseChat ? (
          <div className="flex-1 flex items-center justify-center text-center px-8">
            <div>
              <AlertTriangle className="mx-auto mb-3 text-amber-500" size={28} />
              <p className="text-sm text-slate-400 max-w-sm">
                Your encryption keys aren't unlocked on this device, so room keys can't be wrapped or read here.
              </p>
            </div>
          </div>
        ) : !activeRoom ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
            Select a room to start chatting.
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-surface-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-sm font-semibold text-slate-100">{activeRoom.name}</h3>
                <span className="flex items-center gap-1 text-xs text-teal-500">
                  <Lock size={11} /> End-to-end encrypted
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Invite by email"
                  className="rounded-lg bg-midnight-900 border border-surface-border px-2.5 py-1 text-xs text-slate-100 outline-none focus:border-cyan-500 w-40"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'editor' | 'contributor' | 'viewer')}
                  className="rounded-lg bg-midnight-900 border border-surface-border px-2 py-1 text-xs text-slate-100 outline-none"
                >
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="contributor">Contributor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  className="flex items-center gap-1 rounded-lg bg-midnight-800 hover:bg-midnight-700 disabled:opacity-60 text-slate-200 text-xs font-medium px-2.5 py-1.5"
                >
                  <UserPlus size={13} /> Invite
                </button>
              </div>
            </div>

            {error && (
              <div className="mx-4 mt-3 text-xs text-critical-500 bg-critical-500/10 border border-critical-500/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m) => (
                <div key={m._id} className="text-sm">
                  <span className="text-slate-500 text-xs mr-2">
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-slate-200">{m.plaintext}</span>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="p-4 border-t border-surface-border flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Type a message…"
                className="flex-1 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
              />
              <button
                onClick={handleSend}
                disabled={!draft.trim()}
                className="flex items-center justify-center rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white p-2.5"
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
