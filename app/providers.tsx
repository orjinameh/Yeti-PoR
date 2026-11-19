"use client";
import { ReactNode, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getFullnodeUrl } from "@mysten/sui/client";
import "@mysten/dapp-kit/dist/index.css";

export default function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  // In the browser, RPC calls go through this site's /api/sui-rpc proxy, because some devices/networks cannot reach
  // fullnode.testnet.sui.io directly. Set NEXT_PUBLIC_SUI_RPC_URL to use a different RPC directly instead.
  const networks = useMemo(
    () => ({
      testnet: {
        url: process.env.NEXT_PUBLIC_SUI_RPC_URL || (typeof window !== "undefined" ? `${window.location.origin}/api/sui-rpc` : getFullnodeUrl("testnet")),
      },
    }),
    [],
  );
  return (
    <QueryClientProvider client={qc}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        {/* Slush web wallet: sign in with Google/Apple/passkey in a phone browser, no extension or app install.
            Needs @mysten/dapp-kit >= 0.16 (older versions silently ignore this prop). */}
        <WalletProvider autoConnect slushWallet={{ name: "Yeti Proof-of-Run" }}>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
