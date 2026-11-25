import Link from "next/link";
import { EmptyState } from "../components/ui";

export default function NotFound() {
  return (
    <EmptyState title="Not found">
      <Link href="/" className="underline">
        Back to the dashboard
      </Link>
    </EmptyState>
  );
}
