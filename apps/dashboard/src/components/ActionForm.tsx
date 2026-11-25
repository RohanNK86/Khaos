"use client";
import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "../app/actions";

type ServerAction = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

/** A small form bound to a server action, with pending and result feedback. */
export function ActionForm({
  action,
  hidden,
  label,
  variant = "",
  children,
  confirm,
  disabled = false,
}: {
  action: ServerAction;
  hidden: Record<string, string>;
  label: string;
  variant?: "" | "btn-primary" | "btn-danger";
  children?: ReactNode;
  confirm?: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-3"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <button type="submit" className={`btn ${variant}`} disabled={pending || disabled}>
        {pending ? "Working…" : label}
      </button>
      {state && (
        <span className={`text-lg font-bold ${state.ok ? "text-green-700" : "text-red-700"}`} role="status">
          {state.ok ? "✅" : "❌"} {state.message}
        </span>
      )}
    </form>
  );
}
