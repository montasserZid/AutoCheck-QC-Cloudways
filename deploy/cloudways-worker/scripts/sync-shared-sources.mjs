#!/usr/bin/env node
/**
 * Vendor the shared AutoCheck modules that the Cloudways extraction worker needs.
 *
 * WHY THIS EXISTS
 * ---------------
 * The worker must be self-contained under /home/master/autocheck-worker, with
 * node_modules at /home/master/autocheck-worker/node_modules. Node resolves
 * `puppeteer-core` by walking *upwards* from the importing file, so every
 * compiled file has to live at or below the worker root. If the shared sources
 * are deployed to /home/master/src instead, no ancestor directory contains the
 * worker's node_modules and the build fails with "Cannot find module".
 *
 * So the shared modules are COPIED (never forked, never edited) into
 * deploy/cloudways-worker/vendor/src/... which keeps them inside the worker
 * tree. The worker compiles with rootDir ".", so both the worker sources and the
 * vendored sources are emitted under dist/ and resolve modules through the
 * worker's own node_modules.
 *
 * The file list is derived from the transitive relative-import closure of the
 * two entry modules, so adding a new AutoCheck import to facebook.ts can never
 * silently break the deployment again.
 *
 * MODES
 * -----
 * - In the AutoCheck repo (../../src exists): refresh vendor/src from the repo.
 *   This is the only place the shared code is ever authored.
 * - On the Cloudways host (a standalone tree with no repo): keep the vendor/src
 *   tree that was deployed alongside the worker, but verify it is complete and
 *   matches its manifest.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_SRC = path.resolve(WORKER_DIR, "..", "..", "src");
const VENDOR_DIR = path.join(WORKER_DIR, "vendor");
const VENDOR_SRC = path.join(VENDOR_DIR, "src");
const MANIFEST_FILE = path.join(VENDOR_DIR, "manifest.json");

/** Shared modules the worker entry points need. Everything else follows imports. */
const ENTRY_MODULES = ["server/listing/facebook.ts", "server/listing/secureFetch.ts"];

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const STATIC_IMPORT = /\bfrom\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function isFile(candidate) {
  return existsSync(candidate) && statSync(candidate).isFile();
}

/** Resolve a relative specifier the way TypeScript's node resolution would. */
function resolveRelativeImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((ext) => base + ext),
    ...RESOLVE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find(isFile) ?? null;
}

function collectRelativeImports(file) {
  const source = readFileSync(file, "utf8");
  const specifiers = new Set();
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1].startsWith(".")) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

/** Breadth-first closure of relative imports reachable from ENTRY_MODULES. */
function sharedModuleClosure(repoSrc) {
  const queue = [];
  const included = new Map();

  for (const entry of ENTRY_MODULES) {
    const absolute = path.join(repoSrc, entry);
    if (!isFile(absolute)) {
      throw new Error(`Shared entry module is missing: ${absolute}`);
    }
    queue.push(absolute);
  }

  while (queue.length > 0) {
    const file = queue.shift();
    const relative = path.relative(repoSrc, file);
    if (included.has(relative)) continue;

    const imports = collectRelativeImports(file);
    const missing = [];
    for (const specifier of imports) {
      const resolved = resolveRelativeImport(file, specifier);
      if (!resolved) {
        missing.push(specifier);
        continue;
      }
      if (!resolved.startsWith(repoSrc + path.sep)) {
        // An import that escapes src/ would not be vendored; fail loudly rather
        // than emit a build that cannot resolve it on the server.
        missing.push(`${specifier} (outside ${REPO_SRC})`);
        continue;
      }
      queue.push(resolved);
    }

    if (missing.length > 0) {
      throw new Error(
        `Unresolvable relative import(s) in ${relative}: ${missing.join(", ")}`,
      );
    }

    included.set(relative, file);
  }

  return included;
}

function copyClosure(closure) {
  rmSync(VENDOR_DIR, { recursive: true, force: true });
  const files = [];
  for (const relative of [...closure.keys()].sort()) {
    const source = closure.get(relative);
    const target = path.join(VENDOR_SRC, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    files.push({ path: `src/${relative.split(path.sep).join("/")}`, sha256: sha256(target) });
  }
  writeFileSync(MANIFEST_FILE, `${JSON.stringify({ files }, null, 2)}\n`);
  return files;
}

function listVendorFiles() {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (RESOLVE_EXTENSIONS.includes(path.extname(entry.name))) {
        files.push(path.relative(VENDOR_DIR, absolute).split(path.sep).join("/"));
      }
    }
  };
  if (existsSync(VENDOR_SRC)) walk(VENDOR_SRC);
  return files.sort();
}

function verifyDeployedVendor() {
  if (!existsSync(VENDOR_SRC)) {
    throw new Error(
      [
        "No shared AutoCheck sources available: neither the repository at",
        `  ${REPO_SRC}`,
        "nor a deployed vendor tree at",
        `  ${VENDOR_SRC}`,
        "was found. This server copy of the worker must be deployed with the",
        "vendored sources included. From the AutoCheck repo run",
        "  npm run sync:worker-sources",
        "then copy deploy/cloudways-worker (including vendor/) to the host.",
      ].join("\n"),
    );
  }

  if (!isFile(MANIFEST_FILE)) {
    throw new Error(`Vendored sources found but ${MANIFEST_FILE} is missing. Re-deploy the worker package.`);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8"));
  const expected = new Set((manifest.files ?? []).map((entry) => entry.path));
  const present = new Set(listVendorFiles());

  const problems = [];
  for (const file of expected) {
    if (!present.has(file)) problems.push(`missing ${file}`);
  }
  for (const file of present) {
    if (!expected.has(file)) problems.push(`unexpected ${file}`);
  }
  for (const entry of manifest.files ?? []) {
    const absolute = path.join(VENDOR_DIR, entry.path);
    if (isFile(absolute) && sha256(absolute) !== entry.sha256) {
      problems.push(`checksum mismatch ${entry.path}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Vendored sources are incomplete or modified:\n  ${problems.join("\n  ")}\n` +
        "Re-deploy deploy/cloudways-worker (including vendor/) from a repo where " +
        "'npm run sync:worker-sources' has been run.",
    );
  }

  return expected.size;
}

function main() {
  if (existsSync(REPO_SRC)) {
    const closure = sharedModuleClosure(REPO_SRC);
    const files = copyClosure(closure);
    console.log(
      `[sync-shared-sources] vendored ${files.length} shared AutoCheck module(s) from ${REPO_SRC}:`,
    );
    for (const entry of files) console.log(`  vendor/${entry.path}`);
    return;
  }

  const count = verifyDeployedVendor();
  console.log(
    `[sync-shared-sources] standalone deployment: using the existing vendor/ tree (${count} module(s) verified).`,
  );
}

try {
  main();
} catch (error) {
  console.error(`[sync-shared-sources] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}