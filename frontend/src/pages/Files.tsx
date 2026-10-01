import { useCallback, useEffect, useState, ChangeEvent } from 'react';
import {
  FolderOpen,
  Folder as FolderIcon,
  FileText,
  Upload,
  FolderPlus,
  Loader2,
  Download,
  Trash2,
  RotateCcw,
  ChevronRight,
  AlertTriangle,
  Share2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useKeyStore } from '../store/keyStore';
import {
  generateFileKey,
  exportKeyRaw,
  importKeyRaw,
  encryptFile,
  decryptFile,
  sha256Hex,
  bufferToBase64,
  base64ToBuffer,
} from '../lib/crypto/clientEncryption';
import { wrapFileKey, unwrapFileKey, serializeWrappedKey, deserializeWrappedKey } from '../lib/crypto/pqcClient';

interface FileItem {
  _id: string;
  name: string;
  sizeBytesEncrypted: number;
  mimeTypeDeclared: string;
  wrappedFileKey: string;
  iv: string;
  authTag: string;
  contentHashSha256: string;
  isTrashed: boolean;
  createdAt: string;
}

interface FolderItem {
  _id: string;
  name: string;
}

interface Breadcrumb {
  id: string;
  name: string;
}

/** Splits WebCrypto's combined AES-GCM output into ciphertext + auth tag, matching the wire format every backend model expects. */
function splitAuthTag(combined: ArrayBuffer): { ciphertext: ArrayBuffer; authTag: Uint8Array } {
  const bytes = new Uint8Array(combined);
  const TAG_LEN = 16;
  return {
    ciphertext: bytes.slice(0, bytes.length - TAG_LEN).buffer,
    authTag: bytes.slice(bytes.length - TAG_LEN),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Files() {
  const kemPublicKey = useKeyStore((s) => s.kemPublicKey);
  const kemSecretKey = useKeyStore((s) => s.kemSecretKey);
  const unlocked = useKeyStore((s) => s.unlocked);

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [showTrashed, setShowTrashed] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [shareTarget, setShareTarget] = useState<FileItem | null>(null);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'viewer' | 'contributor' | 'editor' | 'admin'>('viewer');
  const [sharing, setSharing] = useState(false);

  const loadContents = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: foldersData }, { data: filesData }] = await Promise.all([
        api.get('/folders', { params: { parentId: currentFolderId } }),
        api.get('/files', { params: { folderId: currentFolderId } }),
      ]);
      setFolders(foldersData.folders);
      setFiles(filesData.files);

      if (currentFolderId) {
        const { data: pathData } = await api.get(`/folders/${currentFolderId}/path`);
        setBreadcrumbs(pathData.path.map((p: any) => ({ id: p.id, name: p.name })));
      } else {
        setBreadcrumbs([]);
      }
    } catch {
      setError('Could not load this folder.');
    } finally {
      setLoading(false);
    }
  }, [currentFolderId]);

  useEffect(() => {
    loadContents();
  }, [loadContents]);

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      await api.post('/folders', { name: newFolderName.trim(), parentId: currentFolderId });
      setNewFolderName('');
      setShowNewFolder(false);
      await loadContents();
    } catch {
      setError('Could not create folder.');
    }
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file || !kemPublicKey) return;

    setError(null);
    try {
      setUploadStage('Encrypting…');
      const fileKey = await generateFileKey();
      const { ciphertext: combined, iv } = await encryptFile(file, fileKey);
      const { ciphertext, authTag } = splitAuthTag(combined);

      const plaintextBuf = await file.arrayBuffer();
      const contentHashSha256 = await sha256Hex(plaintextBuf);

      const fileKeyRaw = await exportKeyRaw(fileKey);
      const wrapped = await wrapFileKey(fileKeyRaw, kemPublicKey);
      const wrappedFileKey = await serializeWrappedKey(wrapped);

      setUploadStage('Requesting secure upload slot…');
      const { data: uploadSlot } = await api.post('/files/upload-url', {
        declaredMimeType: file.type || 'application/octet-stream',
        declaredSizeBytes: ciphertext.byteLength,
      });

      setUploadStage('Uploading encrypted file…');
      await fetch(uploadSlot.uploadUrl, {
        method: 'PUT',
        body: ciphertext,
        headers: { 'Content-Type': 'application/octet-stream' },
      });

      setUploadStage('Verifying…');
      await api.post('/files/confirm-upload', {
        storageKey: uploadSlot.storageKey,
        name: file.name,
        folderId: currentFolderId,
        declaredMimeType: file.type || 'application/octet-stream',
        sizeBytesEncrypted: ciphertext.byteLength,
        wrappedFileKey,
        iv: bufferToBase64(iv),
        authTag: bufferToBase64(authTag),
        contentHashSha256,
      });

      setNotice(`${file.name} uploaded and encrypted.`);
      await loadContents();
    } catch {
      setError('Upload failed. Your file was encrypted locally but could not be stored.');
    } finally {
      setUploadStage(null);
    }
  }

  async function handleDownload(file: FileItem) {
    if (!kemSecretKey) {
      setError('Your decryption keys are not unlocked on this device.');
      return;
    }
    setBusyId(file._id);
    setError(null);
    try {
      // Source the key/iv/authTag/hash from THIS response, not from the
      // file-list item — the server resolves the correct wrapped key here
      // based on who's asking (owner's own copy, or a grantee's
      // FileShareKey-wrapped copy for a shared file). The list item's own
      // wrappedFileKey is only ever the owner's copy, which would silently
      // fail to decrypt for anyone viewing a file shared with them.
      const { data } = await api.get(`/files/${file._id}/download-url`);

      const wrapped = deserializeWrappedKey(data.wrappedFileKey);
      const fileKeyRaw = await unwrapFileKey(wrapped, kemSecretKey);
      const fileKey = await importKeyRaw(fileKeyRaw);

      const response = await fetch(data.downloadUrl);
      const ciphertext = await response.arrayBuffer();
      const authTagBytes = base64ToBuffer(data.authTag);

      // Recombine ciphertext + auth tag into the single buffer WebCrypto's
      // AES-GCM decrypt expects (see splitAuthTag's counterpart on upload).
      const combined = new Uint8Array(ciphertext.byteLength + authTagBytes.byteLength);
      combined.set(new Uint8Array(ciphertext), 0);
      combined.set(authTagBytes, ciphertext.byteLength);

      const plaintext = await decryptFile(
        { ciphertext: combined.buffer, iv: base64ToBuffer(data.iv) },
        fileKey,
      );

      // Integrity check: confirm the decrypted content actually matches
      // the hash recorded at upload time, not just that decryption
      // succeeded without throwing.
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

  async function handleShare() {
    if (!shareTarget || !kemSecretKey || !shareEmail.trim()) return;
    setSharing(true);
    setError(null);
    try {
      // Look up the recipient's public key — never anything sensitive
      // about them (see users.controller.ts).
      const { data: recipient } = await api.get('/users/lookup', { params: { email: shareEmail.trim() } });

      // To share, we must first recover OUR OWN usable copy of the file
      // key (owner's own wrapped copy, resolved server-side same as a
      // normal download), then re-wrap it specifically for the
      // recipient's ML-KEM public key. The server never sees the
      // unwrapped key at any point in this flow.
      const { data: downloadInfo } = await api.get(`/files/${shareTarget._id}/download-url`);
      const ownWrapped = deserializeWrappedKey(downloadInfo.wrappedFileKey);
      const fileKeyRaw = await unwrapFileKey(ownWrapped, kemSecretKey);

      const recipientKemPublicKey = base64ToBuffer(recipient.kemPublicKey);
      const wrappedForRecipient = await wrapFileKey(fileKeyRaw, recipientKemPublicKey);
      const wrappedFileKeyForGrantee = await serializeWrappedKey(wrappedForRecipient);

      await api.post(`/files/${shareTarget._id}/share`, {
        granteeUserId: recipient.userId,
        role: shareRole,
        wrappedFileKeyForGrantee,
      });

      setNotice(`Shared "${shareTarget.name}" with ${recipient.displayName}.`);
      setShareTarget(null);
      setShareEmail('');
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (code === 'USER_NOT_FOUND_OR_NO_PUBLIC_KEY') {
        setError('No QuantumTrust user with that email was found (or they have no encryption keys set up yet).');
      } else if (code === 'CANNOT_SHARE_WITH_OWNER') {
        setError("You can't share a file with yourself.");
      } else {
        setError('Could not share this file.');
      }
    } finally {
      setSharing(false);
    }
  }

  async function handleTrash(file: FileItem) {
    setBusyId(file._id);
    try {
      await api.post(`/files/${file._id}/trash`);
      await loadContents();
    } catch {
      setError('Could not move file to trash.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(file: FileItem) {
    setBusyId(file._id);
    try {
      await api.post(`/files/${file._id}/restore`);
      await loadContents();
    } catch {
      setError('Could not restore file.');
    } finally {
      setBusyId(null);
    }
  }

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center px-8">
        <AlertTriangle className="text-amber-500 mb-3" size={28} />
        <p className="text-sm text-slate-400 max-w-sm">
          Your encryption keys aren't unlocked on this device, so files can't be encrypted, uploaded, or decrypted
          here.
        </p>
      </div>
    );
  }

  const visibleFiles = files.filter((f) => f.isTrashed === showTrashed);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <FolderOpen size={20} className="text-cyan-500" /> My Files
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Every file is encrypted on your device before it ever leaves the browser.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewFolder((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-midnight-800 hover:bg-midnight-700 text-slate-200 text-sm font-medium px-3 py-2 transition-colors"
          >
            <FolderPlus size={15} /> New folder
          </button>
          <label className="flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium px-3 py-2 transition-colors cursor-pointer">
            {uploadStage ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
            {uploadStage ?? 'Upload'}
            <input type="file" className="hidden" onChange={handleFileSelected} disabled={!!uploadStage} />
          </label>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-sm text-slate-400 mb-4 flex-wrap">
        <button onClick={() => setCurrentFolderId(null)} className="hover:text-cyan-400">
          Home
        </button>
        {breadcrumbs.map((b) => (
          <span key={b.id} className="flex items-center gap-1">
            <ChevronRight size={13} className="text-slate-600" />
            <button onClick={() => setCurrentFolderId(b.id)} className="hover:text-cyan-400">
              {b.name}
            </button>
          </span>
        ))}
      </div>

      {notice && (
        <div className="mb-4 text-sm text-teal-400 bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 text-sm text-critical-500 bg-critical-500/10 border border-critical-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {showNewFolder && (
        <div className="flex items-center gap-2 mb-4">
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            placeholder="Folder name"
            autoFocus
            className="flex-1 max-w-xs rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />
          <button
            onClick={handleCreateFolder}
            className="rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium px-3 py-2"
          >
            Create
          </button>
        </div>
      )}

      <div className="flex items-center gap-4 mb-3 text-xs">
        <button
          onClick={() => setShowTrashed(false)}
          className={!showTrashed ? 'text-cyan-400 font-medium' : 'text-slate-500 hover:text-slate-300'}
        >
          Files
        </button>
        <button
          onClick={() => setShowTrashed(true)}
          className={showTrashed ? 'text-cyan-400 font-medium' : 'text-slate-500 hover:text-slate-300'}
        >
          Trash
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="space-y-1">
          {!showTrashed &&
            folders.map((folder) => (
              <button
                key={folder._id}
                onClick={() => setCurrentFolderId(folder._id)}
                className="w-full flex items-center gap-3 rounded-xl border border-surface-border bg-surface hover:bg-surface-raised px-4 py-3 text-left transition-colors"
              >
                <FolderIcon size={18} className="text-cyan-500 shrink-0" />
                <span className="text-sm text-slate-200 truncate">{folder.name}</span>
              </button>
            ))}

          {visibleFiles.map((file) => (
            <div
              key={file._id}
              className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface px-4 py-3"
            >
              <FileText size={18} className="text-slate-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200 truncate">{file.name}</p>
                <p className="text-xs text-slate-500">{formatBytes(file.sizeBytesEncrypted)} · encrypted</p>
              </div>
              {file.isTrashed ? (
                <button
                  onClick={() => handleRestore(file)}
                  disabled={busyId === file._id}
                  className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50 shrink-0"
                >
                  {busyId === file._id ? <Loader2 className="animate-spin" size={13} /> : <RotateCcw size={13} />}
                  Restore
                </button>
              ) : (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => handleDownload(file)}
                    disabled={busyId === file._id}
                    className="flex items-center gap-1 text-xs text-slate-300 hover:text-cyan-400 disabled:opacity-50"
                  >
                    {busyId === file._id ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />}
                    Download
                  </button>
                  <button
                    onClick={() => setShareTarget(file)}
                    className="flex items-center gap-1 text-xs text-slate-300 hover:text-cyan-400"
                  >
                    <Share2 size={13} />
                    Share
                  </button>
                  <button
                    onClick={() => handleTrash(file)}
                    disabled={busyId === file._id}
                    className="text-slate-400 hover:text-critical-400 disabled:opacity-50"
                    aria-label={`Move ${file.name} to trash`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {!loading && folders.length === 0 && visibleFiles.length === 0 && (
            <div className="text-sm text-slate-500 border border-dashed border-surface-border rounded-2xl p-10 text-center">
              {showTrashed ? 'Trash is empty.' : 'This folder is empty.'}
            </div>
          )}
        </div>
      )}

      {shareTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-surface border border-surface-border rounded-2xl p-5 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-slate-100">Share "{shareTarget.name}"</h2>
              <button onClick={() => setShareTarget(null)} className="text-slate-500 hover:text-slate-300">
                <X size={16} />
              </button>
            </div>
            <label className="block text-xs text-slate-400 mb-1.5">Recipient's email</label>
            <input
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              placeholder="name@example.com"
              autoFocus
              className="w-full mb-4 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
            />
            <label className="block text-xs text-slate-400 mb-1.5">Permission</label>
            <select
              value={shareRole}
              onChange={(e) => setShareRole(e.target.value as typeof shareRole)}
              className="w-full mb-5 rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
            >
              <option value="viewer">Viewer</option>
              <option value="contributor">Contributor</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
            <button
              onClick={handleShare}
              disabled={sharing || !shareEmail.trim()}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-sm font-medium py-2.5"
            >
              {sharing && <Loader2 className="animate-spin" size={15} />}
              Share
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
