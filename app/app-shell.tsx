"use client";
import Providers from "./providers";
import Console from "@/components/Console";

// Loaded with ssr:false from page.tsx: wallets are discovered through the browser, so this must render client-side only.
export default function AppShell() {
  return (
    <Providers>
      <Console />
    </Providers>
  );
}
