import type { StepContract } from "@mcpify/contracts";
import { stepDiff } from "../lib/format";

/** Old step vs proposed step, field by field; changed rows are highlighted. */
export function StepDiff({ before, after }: { before: StepContract | undefined; after: StepContract }) {
  const rows = stepDiff(before, after);
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th className="w-32">Field</th>
            <th>Old step</th>
            <th>Proposed step</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.field} className={r.changed ? "" : "text-neutral-500"}>
              <td className="font-bold">
                {r.field}
                {r.changed && <span className="ml-1 text-accent">●</span>}
              </td>
              <td className={`whitespace-pre-wrap break-all font-mono text-sm ${r.changed ? "bg-red-100 line-through decoration-red-400" : ""}`}>{r.before}</td>
              <td className={`whitespace-pre-wrap break-all font-mono text-sm ${r.changed ? "bg-green-100 font-bold" : ""}`}>{r.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
