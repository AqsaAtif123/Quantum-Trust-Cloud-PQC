import { useQuery } from '@tanstack/react-query';
import { HardDrive, ShieldCheck, Clock, Users } from 'lucide-react';
import { api } from '../lib/api';

interface FileSummary {
  _id: string;
  name: string;
  sizeBytesEncrypted: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function StatCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: string }) {
  return (
    <div className="bg-surface border border-surface-border rounded-xl p-5">
      <div className={`inline-flex p-2 rounded-lg mb-3 ${accent}`}>
        <Icon size={18} />
      </div>
      <div className="font-display text-2xl font-semibold">{value}</div>
      <div className="text-sm text-slate-400">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const { data: filesData, isLoading } = useQuery({
    queryKey: ['files', null],
    queryFn: async () => (await api.get<{ files: FileSummary[] }>('/files')).data,
  });

  const files = filesData?.files ?? [];
  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytesEncrypted, 0);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <h1 className="font-display text-2xl font-semibold mb-1">Dashboard</h1>
      <p className="text-slate-400 mb-8">An overview of your encrypted storage and security posture.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard icon={HardDrive} label="Storage used" value={formatBytes(totalBytes)} accent="bg-cyan-500/10 text-cyan-400" />
        <StatCard icon={ShieldCheck} label="Security score" value="—" accent="bg-verify-500/10 text-verify-400" />
        <StatCard icon={Clock} label="Vault expiries" value="0" accent="bg-warn-500/10 text-warn-400" />
        <StatCard icon={Users} label="Shared with you" value="0" accent="bg-cyan-500/10 text-cyan-400" />
      </div>

      <h2 className="font-display text-lg font-semibold mb-3">Recent files</h2>
      <div className="bg-surface border border-surface-border rounded-xl divide-y divide-surface-border">
        {isLoading && <div className="p-5 text-sm text-slate-500">Loading…</div>}
        {!isLoading && files.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">
            No files yet. Upload your first file to see it here, encrypted before it ever leaves your device.
          </div>
        )}
        {files.slice(0, 6).map((f) => (
          <div key={f._id} className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="truncate">{f.name}</span>
            <span className="text-slate-500 font-mono text-xs">{formatBytes(f.sizeBytesEncrypted)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
