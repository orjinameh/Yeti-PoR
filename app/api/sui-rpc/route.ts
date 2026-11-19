// Same-origin proxy to the Sui fullnode. Some networks/devices cannot reach fullnode.testnet.sui.io directly
// (Safari reports "Load failed"), but they can reach this site, and this server can reach the fullnode.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = process.env.SUI_RPC_UPSTREAM || "https://fullnode.testnet.sui.io:443";

export async function POST(req: Request) {
  const body = await req.text();
  try {
    const r = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store" });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: `Upstream RPC unreachable from the server: ${e?.message ?? e}` } },
      { status: 502 },
    );
  }
}
