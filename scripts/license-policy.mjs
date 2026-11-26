// License policy for production dependencies (SEC-SUP-1).
// Plain English: permissive licenses are fine. Copyleft (GPL/AGPL/LGPL/SSPL)
// and unknown licenses fail the build unless explicitly reviewed below.

export const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Python-2.0",
  "Zlib",
]);

/**
 * Packages whose license metadata is missing or non-standard but which were
 * reviewed by hand. Key: package name. Value: why it's acceptable.
 */
export const REVIEWED_EXCEPTIONS = {};

/**
 * Decide whether an SPDX expression is acceptable.
 * "A OR B" passes if any option is allowed (we may choose it).
 * "A AND B" passes only if every part is allowed.
 */
export function isAllowed(expression) {
  if (!expression) return false;
  const expr = expression.trim().replace(/^\((.*)\)$/, "$1");
  if (/\sOR\s/.test(expr)) return expr.split(/\s+OR\s+/).some(isAllowed);
  if (/\sAND\s/.test(expr)) return expr.split(/\s+AND\s+/).every(isAllowed);
  return ALLOWED.has(expr.replace(/^\(|\)$/g, ""));
}

/** Return the list of violations from `pnpm licenses list --json` output. */
export function findViolations(licensesByType, exceptions = REVIEWED_EXCEPTIONS) {
  const violations = [];
  for (const [license, packages] of Object.entries(licensesByType)) {
    if (isAllowed(license)) continue;
    for (const pkg of packages) {
      if (Object.hasOwn(exceptions, pkg.name)) continue;
      violations.push({ name: pkg.name, versions: pkg.versions, license });
    }
  }
  return violations;
}
