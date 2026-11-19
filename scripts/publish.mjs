// Publishes the Move package to the active Sui env and writes the new ids into .env.local automatically.
// Usage: npm run publish:testnet
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync } from "node:fs";

const run = (args, cwd) => execFileSync("sui", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });

console.log("Active env:", run(["client", "active-env"]).trim());
console.log("Running Move tests...");
try { execFileSync("sui", ["move", "test"], { cwd: "move", stdio: "inherit" }); } catch { console.error("\nMove tests failed. Fix them (or send the output) before publishing."); process.exit(1); }

// The CLI refuses to publish a package that already has an entry in Published.toml. We want a fresh package, so move the old one aside.
if (existsSync("move/Published.toml")) {
  renameSync("move/Published.toml", "move/Published.toml.old");
  console.log("Moved the old move/Published.toml to move/Published.toml.old (the previous package stays on-chain).");
}
console.log("Publishing...");
const out = run(["client", "publish", "--gas-budget", "200000000", "--json"], "move");
const j = JSON.parse(out.slice(out.indexOf("{")));
if (j.effects?.status?.status && j.effects.status.status !== "success") { console.error("Publish failed:", j.effects.status.error ?? j.effects.status); process.exit(1); }
const changes = j.objectChanges ?? [];
const pkg = changes.find((c) => c.type === "published")?.packageId;
const find = (name) => changes.find((c) => c.type === "created" && String(c.objectType).endsWith(`::${name}`))?.objectId;
const ids = { NEXT_PUBLIC_PACKAGE_ID: pkg, NEXT_PUBLIC_LEADERBOARD_ID: find("Leaderboard"), NEXT_PUBLIC_REGISTRY_ID: find("Registry") };
for (const [k, v] of Object.entries(ids)) if (!v) { console.error(`Could not find ${k} in the publish output. Digest: ${j.digest}`); process.exit(1); }

const file = ".env.local";
let text = "";
if (existsSync(file)) { copyFileSync(file, ".env.local.bak"); text = readFileSync(file, "utf8"); }
for (const [k, v] of Object.entries(ids)) {
  const re = new RegExp(`^${k}=.*$`, "m");
  text = re.test(text) ? text.replace(re, `${k}=${v}`) : text + (text && !text.endsWith("\n") ? "\n" : "") + `${k}=${v}\n`;
}
writeFileSync(file, text);
const pub = changes.find((c) => c.type === "created" && String(c.objectType).endsWith("::package::Publisher"))?.objectId;
console.log("\nSetting up wallet displays (names and art)...");
try {
  run(["client", "call", "--package", pkg, "--module", "proof_of_run", "--function", "setup_displays", "--args", "0xd", pub, "--gas-budget", "200000000"]);
  console.log("Displays set up.");
} catch { console.error("Display setup failed. Run it later with: npm run setup:displays"); }
console.log("\nPublished. Wrote to .env.local (old file saved as .env.local.bak):");
for (const [k, v] of Object.entries(ids)) console.log(`  ${k}=${v}`);
console.log("\nRestart the dev server (npm run dev) or redeploy so the new ids are picked up.");
