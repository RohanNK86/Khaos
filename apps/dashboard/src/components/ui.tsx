import type { ReactNode } from "react";
import type { RiskClass } from "@mcpify/contracts";
import { humanize, riskClass, statusClass } from "../lib/format";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-lg text-neutral-700">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2 className="mb-3 text-xl">{title}</h2>}
      {children}
    </section>
  );
}

export function RiskBadge({ risk }: { risk: RiskClass }) {
  return <span className={`badge ${riskClass(risk)}`}>{risk}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusClass(status)}`}>{humanize(status)}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border-[3px] border-dashed border-ink bg-white/60 p-8 text-center">
      <p className="font-display text-xl">{title}</p>
      {children && <div className="mt-2 text-neutral-700">{children}</div>}
    </div>
  );
}

export function JsonBlock({ value, summary = "Raw JSON" }: { value: unknown; summary?: string }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer font-bold">{summary}</summary>
      <pre className="code mt-2 max-h-[32rem]">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-[3px] border-ink bg-cream px-4 py-2">
      <div className="font-display text-2xl">{value}</div>
      <div className="text-sm font-bold uppercase tracking-wide">{label}</div>
    </div>
  );
}

export function KeyValues({ entries }: { entries: [string, ReactNode][] }) {
  if (entries.length === 0) return <p className="text-neutral-600">None</p>;
  return (
    <table className="tbl">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td className="w-1/3 font-bold">{k}</td>
            <td className="break-all">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="card bg-red-200">
      <p className="font-display text-xl">Something went wrong</p>
      <p className="mt-1 font-mono text-sm">{message}</p>
    </div>
  );
}
