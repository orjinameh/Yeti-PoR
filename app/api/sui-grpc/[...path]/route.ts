// Optional same-origin gRPC-web proxy (enable with NEXT_PUBLIC_SUI_GRPC_PROXY=1). For browsers or networks that cannot
// reach the Sui fullnode directly, this server forwards the gRPC-web request and returns the response unchanged.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = (process.env.SUI_GRPC_UPSTREAM || process.env.NEXT_PUBLIC_SUI_GRPC_URL || "https://fullnode.testnet.sui.io:443").replace(/\/$/, "");
const FORWARD = ["content-type", "accept", "x-grpc-web", "x-user-agent", "grpc-timeout"];

export async function POST(req: Request, ctx: { params: { path: string[] } }) {
  const headers = new Headers();
  for (const k of FORWARD) {
    const v = req.headers.get(k);
    if (v) headers.set(k, v);
  }
  try {
    const r = await fetch(`${UPSTREAM}/${ctx.params.path.join("/")}`, { method: "POST", headers, body: await req.arrayBuffer(), cache: "no-store" });
    const out = new Headers();
    r.headers.forEach((v, k) => {
      if (k === "content-type" || k.startsWith("grpc-")) out.set(k, v);
    });
    return new Response(await r.arrayBuffer(), { status: r.status, headers: out });
  } catch (e: any) {
    return new Response(`Upstream gRPC unreachable from the server: ${e?.message ?? e}`, { status: 502 });
  }
}
