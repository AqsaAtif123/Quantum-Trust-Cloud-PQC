import { useEffect, useState } from 'react';
import { Share2, FileText, Download, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useKeyStore } from '../store/keyStore';
import { importKeyRaw, decryptFile, sha256Hex, base64ToBuffer } from '../lib/crypto/clientEncryption';
import { unwrapFileKey, deserializeWrappedKey } from '../lib/crypto/pqcClient';

type Role = 'viewer' | 'contributor' | 'editor' | 'admin';

interface SharedFile {
  _id: string;
  name: string;
  sizeBytesEncrypted: number;
  mimeTypeDeclared: string;
  myRole: Role;
  createdAt: string;
}

const ROLE_LABELS: Record<Role, string> = {
  viewer: 'Viewer',
  contributor: 'Contributor',
  editor: 'Editor',
  admin: 'Admin',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Shared() {
  const kemSecretKey = useKeyStore((s) => s.kemSecretKey);
  const unlocked = useKeyStore((s) => s.unlocked);

  const [files, setFiles] = useState<SharedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/files/shared-with-me');
      setFiles(data.files);
    } catch {
      setError('Could not load files shared with you.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDownload(file: SharedFile) {
    if (!kemSecretKey) {
      setError('Your decryption keys are not unlocked on this device.');
      return;
    }
    setBusyId(file._id);
    setError(null);
    try {
      // The server resolves this to OUR grantee-specific wrapped key
      // (FileShareKey), not the owner's own copy — see files.controller.ts
      // getDownloadUrl, which checks who's actually asking.
      const { data } = await api.get(`/files/${file._id}/download-url`);

      const wrapped = deserializeWrappedKey(data.wrappedFileKey);
      const fileKeyRaw = await unwrapFileKey(wrapped, kemSecretKey);
      const fileKey = await importKeyRaw(fileKeyRaw);

      const response = await fetch(data.downloadUrl);
      const ciphertext = await response.arrayBuffer();
      const authTagBytes = base64ToBuffer(data.authTag);

      const combined = new Uint8Array(ciphertext.byteLength + authTagBytes.byteLength);
      combined.set(new Uint8Array(ciphertext), 0);
      combined.set(authTagBytes, ciphertext.byteLength);

      const plaintext = await decryptFile({ ciphertext: combined.buffer, iv: base64ToBuffer(data.iv) }, fileKey);

      const actualHash = await sha256Hex(plaintext);
      if (actualHash !== data.contentHashSha256) {
        setError(`${file.name} failed integrity verification after download — the file may be corrupted.`);
        return;
      }

      const blob = new Blob([plaintext], { type: file.mimeTypeDeclared });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(`Could not download and decrypt ${file.name}.`);
    } finally {
      setBusyId(null);
    }
  }

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center px-8">
        <AlertTriangle className="text-amber-500 mb-3" size={28} />
        <p className="text-sm text-slate-400 max-w-sm">
          Your encryption keys aren't unlocked on this device, so shared files can't be decrypted here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
          <Share2 size={20} className="text-cyan-500" /> Shared with me
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Files other people have shared directly with you, decrypted using your own key.
        </p>
      </div>

      {error && (
        <div className="mb-4 text-sm text-critical-500 bg-critical-500/10 border border-critical-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : files.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-surface-border rounded-2xl p-10 text-center">
          Nothing has been shared with you yet.
        </div>
      ) : (
        <div className="space-y-1">
          {files.map((file) => (
            <div
              key={file._id}
              className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface px-4 py-3"
            >
              <FileText size={18} className="text-slate-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200 truncate">{file.name}</p>
                <p className="text-xs text-slate-500">
                  {formatBytes(file.sizeBytesEncrypted)} · {ROLE_LABELS[file.myRole]} access
                </p>
              </div>
              <button
                onClick={() => handleDownload(file)}
                disabled={busyId === file._id}
                className="flex items-center gap-1 text-xs text-slate-300 hover:text-cyan-400 disabled:opacity-50 shrink-0"
              >
                {busyId === file._id ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />}
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
