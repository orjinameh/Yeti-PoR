export const PACKAGE_ID = process.env.NEXT_PUBLIC_PACKAGE_ID ?? "";
export const LEADERBOARD_ID = process.env.NEXT_PUBLIC_LEADERBOARD_ID ?? "";
export const RANDOM_ID = "0x8";
export const CLOCK_ID = "0x6";
export const MODULE = "proof_of_run";
export const REGISTRY_ID = process.env.NEXT_PUBLIC_REGISTRY_ID ?? "";

// Sui retired JSON-RPC on public nodes, so the app talks gRPC-web. Default is the public testnet fullnode;
// set NEXT_PUBLIC_SUI_GRPC_URL to a provider endpoint. Set NEXT_PUBLIC_SUI_GRPC_PROXY=1 to route through this
// site's /api/sui-grpc route (for browsers/networks that cannot reach the fullnode directly).
export const GRPC_UPSTREAM = process.env.NEXT_PUBLIC_SUI_GRPC_URL || "https://fullnode.testnet.sui.io:443";
export const USE_GRPC_PROXY = process.env.NEXT_PUBLIC_SUI_GRPC_PROXY === "1";
export const GRPC_URL = USE_GRPC_PROXY ? "this site's /api/sui-grpc proxy" : GRPC_UPSTREAM;
