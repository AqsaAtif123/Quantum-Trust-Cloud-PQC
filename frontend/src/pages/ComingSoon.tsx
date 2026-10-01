export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="font-display text-2xl font-semibold mb-2">{title}</h1>
      <p className="text-slate-400">
        This section is scaffolded in the navigation and routed, but its full workflow is built in the next
        development phase.
      </p>
    </div>
  );
}
