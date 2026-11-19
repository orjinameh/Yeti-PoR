import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { GRPC_UPSTREAM, USE_GRPC_PROXY } from "@/lib/config";

export const dAppKit = createDAppKit({
  networks: ["testnet"],
  createClient(network) {
    const baseUrl = USE_GRPC_PROXY && typeof window !== "undefined" ? `${window.location.origin}/api/sui-grpc` : GRPC_UPSTREAM;
    return new SuiGrpcClient({ network, baseUrl });
  },
  // Slush web wallet: sign in with Google/Apple/passkey in a phone browser, no extension or app install.
  // The exact field names aren't in the docs; the cast keeps this compiling. The Slush web wallet defaults to mainnet, so network is set explicitly.
  // Check the real type with: grep -n "SlushWalletConfig" -A12 node_modules/@mysten/dapp-kit-core/dist/types-*.d.mts
  slushWalletConfig: { name: "Yeti Proof-of-Run", appName: "Yeti Proof-of-Run", network: "testnet" } as any,
});

// global type registration so the dApp Kit hooks infer the configured networks and client
declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
