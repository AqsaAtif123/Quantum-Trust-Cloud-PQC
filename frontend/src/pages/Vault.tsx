import { useEffect, useState, ChangeEvent } from 'react';
import {
  Shield,
  Upload,
  Loader2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  PenLine,
  Award,
  Link as LinkIcon,
  Download,
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
import { wrapFileKey, unwrapFileKey, serializeWrappedKey, deserializeWrappedKey, signDocumentHash } from '../lib/crypto/pqcClient';

type VaultCategory =
  | 'cnic'
  | 'passport'
  | 'degree'
  | 'certificate'
  | 'license'
  | 'contract'
  | 'financial_document'
  | 'employment_document'
  | 'other';

type VaultStatus = 'valid' | 'expiring_soon' | 'expired' | 'no_expiry';

interface VaultDoc {
  id: string;
  category: VaultCategory;
  name: string;
  mimeTypeDeclared: string;
  contentHashSha256: string;
  expiryDate: string | null;
  status: VaultStatus;
  hasSignature: boolean;
  hasCertificate: boolean;
  createdAt: string;
}

const CATEGORY_LABELS: Record<VaultCategory, string> = {
  cnic: 'CNIC',
  passport: 'Passport',
  degree: 'Degree',
  certificate: 'Certificate',
  license: 'License',
  contract: 'Contract',
  financial_document: 'Financial document',
  employment_document: 'Employment document',
  other: 'Other',
};

const STATUS_STYLES: Record<VaultStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  valid: { label: 'Valid', className: 'text-teal-400 bg-teal-500/10 border-teal-500/30', Icon: CheckCircle2 },
  expiring_soon: { label: 'Expiring soon', className: 'text-amber-400 bg-amber-500/10 border-amber-500/30', Icon: Clock },
  expired: { label: 'Expired', className: 'text-critical-400 bg-critical-500/10 border-critical-500/30', Icon: AlertTriangle },
  no_expiry: { label: 'No expiry', className: 'text-slate-400 bg-slate-500/10 border-slate-500/30', Icon: Shield },
};

/** Splits WebCrypto's combined AES-GCM output into ciphertext + auth tag, matching the wire format every backend model expects. */
function splitAuthTag(combined: ArrayBuffer): { ciphertext: ArrayBuffer; authTag: Uint8Array } {
  const bytes = new Uint8Array(combined);
  const TAG_LEN = 16;
  return {
    ciphertext: bytes.slice(0, bytes.length - TAG_LEN).buffer,
    authTag: bytes.slice(bytes.length - TAG_LEN),
  };
}

export default function Vault() {
  const kemPublicKey = useKeyStore((s) => s.kemPublicKey);
  const kemSecretKey = useKeyStore((s) => s.kemSecretKey);
  const dsaSecretKey = useKeyStore((s) => s.dsaSecretKey);
  const unlocked = useKeyStore((s) => s.unlocked);

  const [documents, setDocuments] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<VaultCategory>('other');
  const [uploadExpiry, setUploadExpiry] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStage, setUploadStage] = useState<string | null>(null);

  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  async function loadDocuments() {
    setLoading(true);
    try {
      const { data } = await api.get('/vault');
      setDocuments(data.documents);
    } catch {
      setError('Could not load your vault.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setUploadFile(e.target.files?.[0] ?? null);
  }

  async function handleUpload() {
    if (!uploadFile || !kemPublicKey) return;
    setError(null);

    try {
      setUploadStage('Encrypting…');
      const fileKey = await generateFileKey();
      const { ciphertext: combined, iv } = await encryptFile(uploadFile, fileKey);
      const { ciphertext, authTag } = splitAuthTag(combined);

      const plaintextBuf = await uploadFile.arrayBuffer();
      const contentHashSha256 = await sha256Hex(plaintextBuf);

      const fileKeyRaw = await exportKeyRaw(fileKey);
      const wrapped = await wrapFileKey(fileKeyRaw, kemPublicKey);
      const wrappedFileKey = await serializeWrappedKey(wrapped);

      setUploadStage('Requesting secure upload slot…');
      const { data: uploadSlot } = await api.post('/vault/upload-url', {
        declaredMimeType: uploadFile.type || 'application/octet-stream',
        declaredSizeBytes: ciphertext.byteLength,
      });

      setUploadStage('Uploading encrypted document…');
      await fetch(uploadSlot.uploadUrl, {
        method: 'PUT',
        body: ciphertext,
        headers: { 'Content-Type': 'application/octet-stream' },
      });

      setUploadStage('Confirming…');
      await api.post('/vault/confirm-upload', {
        storageKey: uploadSlot.storageKey,
        name: uploadFile.name,
        category: uploadCategory,
        declaredMimeType: uploadFile.type || 'application/octet-stream',
        sizeBytesEncrypted: ciphertext.byteLength,
        wrappedFileKey,
        iv: bufferToBase64(iv),
        authTag: bufferToBase64(authTag),
        contentHashSha256,
        expiryDate: uploadExpiry ? new Date(uploadExpiry).toISOString() : undefined,
      });

      setUploadFile(null);
      setUploadExpiry('');
      setShowUpload(false);
      setNotice('Document uploaded and encrypted.');
      await loadDocuments();
    } catch {
      setError('Upload failed. Your document was encrypted locally but could not be stored.');
    } finally {
      setUploadStage(null);
    }
  }

  async function handleDownload(doc: VaultDoc) {
    if (!kemSecretKey) {
      setError('Your decryption keys are not unlocked on this device.');
      return;
    }
    setBusyDocId(doc.id);
    setError(null);
    try {
      const { data } = await api.get(`/vault/${doc.id}/download-url`);

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
        setError(`${doc.name} failed integrity verification after download — the document may be corrupted.`);
        return;
      }

      const blob = new Blob([plaintext], { type: doc.mimeTypeDeclared });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(`Could not download and decrypt ${doc.name}.`);
    } finally {
      setBusyDocId(null);
    }
  }

  async function handleSign(doc: VaultDoc) {
    if (!dsaSecretKey) {
      setError('Your signing key is not unlocked on this device.');
      return;
    }
    setBusyDocId(doc.id);
    setError(null);
    try {
      const hashBytes = new Uint8Array(doc.contentHashSha256.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
      const signature = signDocumentHash(hashBytes, dsaSecretKey);
      await api.post(`/vault/${doc.id}/sign`, { signatureBase64: bufferToBase64(signature) });
      setNotice(`${doc.name} signed with your quantum-safe signature.`);
      await loadDocuments();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Signing failed.');
    } finally {
      setBusyDocId(null);
    }
  }

  async function handleCertify(doc: VaultDoc) {
    setBusyDocId(doc.id);
    setError(null);
    try {
      const { data } = await api.post(`/vault/${doc.id}/certificate`);
      setNotice(
        data.blockchainNotarized
          ? `Certificate issued and notarized on-chain for ${doc.name}.`
          : `Certificate issued for ${doc.name}. Blockchain notarization is not configured on this deployment, so this certificate has no on-chain reference yet.`,
      );
      await loadDocuments();
    } catch {
      setError('Certificate generation failed.');
    } finally {
      setBusyDocId(null);
    }
  }

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center px-8">
        <AlertTriangle className="text-amber-500 mb-3" size={28} />
        <p className="text-sm text-slate-400 max-w-sm">
          Your encryption keys aren't unlocked on this device, so vault documents can't be encrypted, signed, or read
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <Shield size={20} className="text-cyan-500" /> Smart Vault
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Client-side encrypted documents with quantum-safe signatures and integrity certificates.
          </p>
        </div>
        <button
          onClick={() => setShowUpload((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium px-3 py-2 transition-colors"
        >
          <Upload size={15} /> Add document
        </button>
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

      {showUpload && (
        <div className="bg-surface border border-surface-border rounded-2xl p-5 mb-6">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Category</label>
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value as VaultCategory)}
                className="w-full rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Expiry date (optional)</label>
              <input
                type="date"
                value={uploadExpiry}
                onChange={(e) => setUploadExpiry(e.target.value)}
                className="w-full rounded-lg bg-midnight-900 border border-surface-border px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>
          </div>
          <input
            type="file"
            onChange={handleFileChange}
            className="block w-full text-sm text-slate-300 mb-4 file:mr-3 file:rounded-lg file:border-0 file:bg-midnight-800 file:text-slate-200 file:px-3 file:py-1.5 file:text-sm"
          />
          <button
            onClick={handleUpload}
            disabled={!uploadFile || !!uploadStage}
            className="flex items-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-sm font-medium px-4 py-2"
          >
            {uploadStage && <Loader2 className="animate-spin" size={15} />}
            {uploadStage ?? 'Encrypt & upload'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : documents.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-surface-border rounded-2xl p-10 text-center">
          No documents in your vault yet.
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => {
            const status = STATUS_STYLES[doc.status];
            const StatusIcon = status.Icon;
            return (
              <div
                key={doc.id}
                className="bg-surface border border-surface-border rounded-xl p-4 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="text-slate-500 shrink-0" size={20} />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-100 truncate">{doc.name}</p>
                    <p className="text-xs text-slate-500">
                      {CATEGORY_LABELS[doc.category]}
                      {doc.expiryDate && ` · expires ${new Date(doc.expiryDate).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`flex items-center gap-1 text-xs border rounded-full px-2 py-0.5 ${status.className}`}
                  >
                    <StatusIcon size={11} /> {status.label}
                  </span>

                  <button
                    onClick={() => handleDownload(doc)}
                    disabled={busyDocId === doc.id}
                    className="flex items-center gap-1 text-xs text-slate-300 hover:text-cyan-400 disabled:opacity-50"
                  >
                    {busyDocId === doc.id ? <Loader2 className="animate-spin" size={12} /> : <Download size={12} />}
                    Download
                  </button>

                  {doc.hasSignature ? (
                    <span className="flex items-center gap-1 text-xs text-teal-400">
                      <PenLine size={12} /> Signed
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSign(doc)}
                      disabled={busyDocId === doc.id}
                      className="flex items-center gap-1 text-xs text-slate-300 hover:text-cyan-400 disabled:opacity-50"
                    >
                      <PenLine size={12} /> Sign
                    </button>
                  )}

                  {doc.hasCertificate ? (
                    <span className="flex items-center gap-1 text-xs text-teal-400">
                      <LinkIcon size={12} /> Certified
                    </span>
                  ) : (
                    <button
                      onClick={() => handleCertify(doc)}
                      disabled={busyDocId === doc.id}
                      className="flex items-center gap-1 text-xs text-slate-300 hover:text-cyan-400 disabled:opacity-50"
                    >
                      <Award size={12} /> Certify
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
