import type { Condition, StepContract } from "@mcpify/contracts";
import { describeAction, describeCondition, describeLocator } from "../lib/format";
import { RiskBadge } from "./ui";

function Conditions({ label, items }: { label: string; items: Condition[] }) {
  return (
    <div>
      <p className="text-sm font-bold uppercase">{label}</p>
      {items.length === 0 ? (
        <p className="text-neutral-500">none</p>
      ) : (
        <ul className="list-inside list-disc">
          {items.map((c, i) => (
            <li key={i}>{describeCondition(c)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StepCard({ step, index, highlight }: { step: StepContract; index: number; highlight?: boolean }) {
  return (
    <article className={`card ${highlight ? "bg-orange/20" : ""}`}>
      <header className="mb-2 flex flex-wrap items-start gap-3">
        <span className="font-display text-2xl">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">{step.intent}</p>
          <p className="font-mono text-sm text-neutral-600">{step.id}</p>
        </div>
        <RiskBadge risk={step.risk} />
        <span className="badge bg-white">repair: {step.repair}</span>
        {step.sensitive && <span className="badge bg-red-200">sensitive</span>}
        {highlight && <span className="badge bg-orange">changed</span>}
      </header>
      <p className="mb-3">
        <span className="font-bold">Action:</span> <code>{describeAction(step.action)}</code>
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-sm font-bold uppercase">Locators (best first)</p>
          {step.locators.length === 0 ? (
            <p className="text-neutral-500">none</p>
          ) : (
            <ol className="list-inside list-decimal">
              {step.locators.map((l, i) => (
                <li key={i} className="break-all">
                  {describeLocator(l)}
                </li>
              ))}
            </ol>
          )}
        </div>
        <Conditions label="Pre (before acting)" items={step.pre} />
        <Conditions label="Post (verified after)" items={step.post} />
      </div>
    </article>
  );
}
