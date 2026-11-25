"use client";
import { ErrorPanel } from "../components/ui";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof Error ? ("digest" in error && error.digest ? `${error.message} (digest ${error.digest})` : error.message) : String(error);
  return (
    <div className="space-y-4">
      <ErrorPanel message={message} />
      <button type="button" className="btn" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}
