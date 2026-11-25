import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Nav } from "../components/Nav";
import { requestSource } from "../lib/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCPify · Owner dashboard",
  description: "Verified tools, runs, repairs and receipts for your site.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const source = await requestSource();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Plain stylesheet link (not next/font) so offline builds never fail; system fallbacks are in globals.css. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;700&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <header className="flex flex-wrap items-center gap-4 border-b-[3px] border-ink bg-cream px-8 py-4">
          <Link href="/" className="font-display text-3xl no-underline">
            MCP<span className="text-accent">ify</span>
          </Link>
          <span className="badge bg-white">owner dashboard</span>
          {source.mock && (
            <span className="badge bg-yellow-200" title={source.reason}>
              mock data
            </span>
          )}
          <div className="ml-auto">
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-8 py-8">{children}</main>
      </body>
    </html>
  );
}
