// Publishes the Move package and writes the three IDs into .env.local.
// Usage: npm run publish:testnet   (uses whatever network `sui client active-env` is set to)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const moveDir = resolve(root, "move");
const envPath = resolve(root, ".env.local");

const run = (args, opts = {}) => execFileSync("sui", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });

console.log("Network:", run(["client", "active-env"]).trim());

// A previous publish leaves Published.toml behind, and sui refuses to publish again with it present.
const pub = resolve(moveDir, "Published.toml");
if (existsSync(pub)) {
  const backup = `${pub}.${Date.now()}.bak`;
  renameSync(pub, backup);
  console.log("Moved the old publish record to", backup);
}

console.log("Publishing... (full output is saved to publish.log in the project root)");
const r = spawnSync("sui", ["client", "publish", "--gas-budget", "200000000", "--json"], { cwd: moveDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
writeFileSync(resolve(root, "publish.log"), `EXIT ${r.status}\n\n--- STDERR ---\n${r.stderr}\n\n--- STDOUT ---\n${r.stdout}`);
if (r.status !== 0) {
  console.error("Publish failed. Open publish.log in the editor and look at the first ERROR near the top.");
  process.exit(1);
}
const out = r.stdout;
const json = JSON.parse(out.slice(out.indexOf("{")));
const changes = json.objectChanges ?? json.object_changes ?? [];
const pkg = changes.find((c) => c.type === "published");
const find = (name) => changes.find((c) => c.type === "created" && String(c.objectType ?? c.object_type).endsWith(`::proof_of_run::${name}`));
const lb = find("Leaderboard");
const reg = find("Registry");
if (!pkg || !lb || !reg) {
  console.error("Could not find the package, Leaderboard or Registry in the publish output. Copy the IDs by hand.");
  process.exit(1);
}
const vars = {
  NEXT_PUBLIC_PACKAGE_ID: pkg.packageId ?? pkg.package_id,
  NEXT_PUBLIC_LEADERBOARD_ID: lb.objectId ?? lb.object_id,
  NEXT_PUBLIC_REGISTRY_ID: reg.objectId ?? reg.object_id,
};

let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
for (const [k, v] of Object.entries(vars)) {
  const line = `${k}=${v}`;
  env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), line) : env + (env.endsWith("\n") || env === "" ? "" : "\n") + line + "\n";
}
writeFileSync(envPath, env);
console.log("\nWrote to .env.local:");
for (const [k, v] of Object.entries(vars)) console.log(`  ${k}=${v}`);
console.log("\nAlso set these three in Vercel (Project Settings > Environment Variables), then redeploy.");
