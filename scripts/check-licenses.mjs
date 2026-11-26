import { execFileSync } from "node:child_process";
import { findViolations } from "./license-policy.mjs";

const raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
  encoding: "utf8",
});
// With zero production dependencies pnpm prints a plain sentence instead of
// JSON. Accept exactly that case; any other unparseable output fails closed.
const text = raw.trim();
const data = text === "No licenses in packages found" ? {} : JSON.parse(text);
const violations = findViolations(data);
const total = Object.values(data).reduce((n, pkgs) => n + pkgs.length, 0);

if (violations.length > 0) {
  console.error(`License check FAILED: ${violations.length} package(s) need review.`);
  for (const v of violations) console.error(`  ${v.name}@${v.versions} -> ${v.license}`);
  console.error("Review each one, then allow it in scripts/license-policy.mjs with a reason.");
  process.exit(1);
}
console.log(`License check passed (${total} production package(s)).`);
