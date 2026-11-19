// One-time per published package: creates the Display V2 objects so wallets show names and art for
// Receipt, Cosmetic, Achievement and Trophy. Usage: npm run setup:displays [publisherObjectId]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sui = (args) => execFileSync("sui", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });
const jsonOf = (t) => JSON.parse(t.slice(Math.min(...["{", "["].map((c) => (t.indexOf(c) < 0 ? 1e9 : t.indexOf(c))))));

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const pkg = process.argv[3] ?? env.NEXT_PUBLIC_PACKAGE_ID;
if (!pkg) { console.error("NEXT_PUBLIC_PACKAGE_ID missing in .env.local"); process.exit(1); }

let publisher = process.argv[2];
if (!publisher) {
  const objs = jsonOf(sui(["client", "objects", "--json"]));
  const ids = (Array.isArray(objs) ? objs : []).map((o) => o.data ?? o).filter((d) => String(d.type ?? d.objectType ?? "").includes("::package::Publisher")).map((d) => d.objectId);
  const want = pkg.replace(/^0x/, "").toLowerCase();
  for (const id of ids) {
    if (sui(["client", "object", id, "--json"]).toLowerCase().includes(want)) { publisher = id; break; }
  }
  if (!publisher) { console.error("Could not find the Publisher object for this package in your wallet. Pass it: npm run setup:displays 0x<publisherId>"); process.exit(1); }
}
console.log("Package:", pkg, "\nPublisher:", publisher);
const out = sui(["client", "call", "--package", pkg, "--module", "proof_of_run", "--function", "setup_displays", "--args", "0xd", publisher, "--gas-budget", "200000000"]);
console.log(out.split("\n").filter((l) => /Digest|Status|Error/i.test(l)).join("\n") || out);
console.log("Displays set up. Wallets/explorers may take a minute to show the art.");
