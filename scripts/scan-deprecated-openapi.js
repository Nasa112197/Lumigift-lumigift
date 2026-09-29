/**
 * Scan openapi.yaml for deprecated operations and report them.
 *
 * Usage: node scripts/scan-deprecated-openapi.js
 *
 * Exit code 0: no deprecated operations (or non-blocking deprecation found).
 * Exit code 1: failed to parse openapi.yaml.
 *
 * Issue #116: CI detects deprecations and reports them as workflow warnings.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// js-yaml is a transitive dependency; fall back to a simple YAML-is-JSON parse
// for the subset of YAML we need if the module isn't resolvable.
let yaml;
try {
  yaml = require("js-yaml");
} catch {
  // Minimal fallback: only works if the YAML file happens to be valid JSON
  yaml = { load: JSON.parse };
}

const SPEC_PATH = path.resolve(process.cwd(), "openapi.yaml");

if (!fs.existsSync(SPEC_PATH)) {
  console.error(`openapi.yaml not found at ${SPEC_PATH}`);
  process.exit(1);
}

let spec;
try {
  spec = yaml.load(fs.readFileSync(SPEC_PATH, "utf8"));
} catch (/** @type {any} */ err) {
  console.error("Failed to parse openapi.yaml:", err.message);
  process.exit(1);
}

const deprecated = [];

for (const [routePath, methods] of Object.entries(spec.paths ?? {})) {
  if (typeof methods !== "object" || methods === null) continue;

  for (const [method, operation] of Object.entries(methods)) {
    // Skip non-operation keys like `parameters`, `summary`, `description`
    const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
    if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
    if (typeof operation !== "object" || operation === null) continue;

    if (operation.deprecated === true) {
      deprecated.push({
        method: method.toUpperCase(),
        path: routePath,
        operationId: operation.operationId ?? null,
        summary: operation.summary ?? "",
      });
    }
  }
}

if (deprecated.length === 0) {
  console.log("✅ No deprecated operations found in openapi.yaml.");
  process.exit(0);
}

// Print as GitHub Actions warning annotations when running in CI
const isCI = process.env.CI === "true";

if (isCI) {
  for (const { method, path: opPath, summary } of deprecated) {
    // GitHub Actions warning annotation format
    console.log(
      `::warning file=openapi.yaml::Deprecated operation: ${method} ${opPath} — ${summary || "(no summary)"}`
    );
  }
} else {
  console.warn("⚠️  Deprecated operations:");
  for (const { method, path: opPath, operationId, summary } of deprecated) {
    const id = operationId ? ` [${operationId}]` : "";
    console.warn(`   ${method} ${opPath}${id} — ${summary || "(no summary)"}`);
  }
}

console.warn(
  `\n${deprecated.length} deprecated operation(s) found. Remove or migrate them before the next major release.\n`
);

// Non-blocking: exit 0 so the workflow continues.
// Change to `process.exit(1)` to enforce strict no-deprecation policy.
process.exit(0);
