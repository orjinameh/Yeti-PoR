"use client";
import { ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getFullnodeUrl } from "@mysten/sui/client";
import "@mysten/dapp-kit/dist/index.css";

const networks = { testnet: { url: getFullnodeUrl("testnet") } };

export default function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
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
