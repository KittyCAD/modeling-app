#!/usr/bin/env node
//
// Run from the repository root after building the transpiler binary:
//   cd rust && cargo build --bin transpile -p kcl-lib && cd ..
//   node scripts/seed-kcl-sketch-solve-docs.mjs
//
// If your binary is in a non-default location, set TRANSPILE_BIN:
//   TRANSPILE_BIN=/path/to/transpile node scripts/seed-kcl-sketch-solve-docs.mjs
//
// The script reads docs/kcl-lang and writes mirrored output to
// docs/kcl-sketch-solve. For blocks that fail transpilation, it leaves the
// original code unchanged and inserts `<!-- transpile failed -->` immediately
// before the block.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, "docs", "kcl-lang");
const outputRoot = path.join(repoRoot, "docs", "kcl-sketch-solve");

const transpileBin =
  process.env.TRANSPILE_BIN ||
  firstExistingPath([
    path.join(repoRoot, "target", "debug", "transpile"),
    path.join(repoRoot, "rust", "target", "debug", "transpile"),
    path.join(repoRoot, "target", "release", "transpile"),
    path.join(repoRoot, "rust", "target", "release", "transpile"),
  ]);

if (!fs.existsSync(sourceRoot)) {
  console.error(`Source directory not found: ${sourceRoot}`);
  process.exit(1);
}

if (!transpileBin || !fs.existsSync(transpileBin)) {
  console.error(
    "Transpiler binary not found. Build it first with `cargo build --bin transpile -p kcl-lib` from `rust/`, or set TRANSPILE_BIN.",
  );
  process.exit(1);
}

fs.mkdirSync(outputRoot, { recursive: true });

const markdownFiles = walkMarkdownFiles(sourceRoot);
console.log(`Using transpiler: ${transpileBin}`);
console.log(`Reading from: ${sourceRoot}`);
console.log(`Writing to: ${outputRoot}`);
console.log(`Found ${markdownFiles.length} markdown files`);

const summary = {
  files: 0,
  attempted: 0,
  converted: 0,
  failed: 0,
  skipped: 0,
};

for (const inputPath of markdownFiles) {
  const relativePath = path.relative(sourceRoot, inputPath);
  const outputPath = path.join(outputRoot, relativePath);
  console.log(`Processing: ${relativePath}`);
  const source = fs.readFileSync(inputPath, "utf8");
  const { content, stats } = migrateMarkdownFile(source, inputPath);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);

  summary.files += 1;
  summary.attempted += stats.attempted;
  summary.converted += stats.converted;
  summary.failed += stats.failed;
  summary.skipped += stats.skipped;
}

console.log(
  `Seeded ${summary.files} files into ${path.relative(repoRoot, outputRoot)}`,
);
console.log(`Attempted: ${summary.attempted}`);
console.log(`Converted: ${summary.converted}`);
console.log(`Failed: ${summary.failed}`);
console.log(`Skipped: ${summary.skipped}`);

function migrateMarkdownFile(source, inputPath) {
  const lines = source.split("\n");
  const out = [];
  const stats = {
    attempted: 0,
    converted: 0,
    failed: 0,
    skipped: 0,
  };

  let inFence = false;
  let openingLine = "";
  let openingInfo = "";
  let blockLines = [];

  for (const line of lines) {
    if (!inFence) {
      const openingMatch = line.match(/^```([^\r\n]*)$/);
      if (openingMatch) {
        inFence = true;
        openingLine = line;
        openingInfo = openingMatch[1].trim();
        blockLines = [];
      } else {
        out.push(line);
      }
      continue;
    }

    if (/^```\s*$/.test(line)) {
      const block = blockLines.join("\n");
      const transformed = processFence({
        openingLine,
        openingInfo,
        block,
        inputPath,
        stats,
      });
      out.push(...transformed);
      inFence = false;
      openingLine = "";
      openingInfo = "";
      blockLines = [];
      continue;
    }

    blockLines.push(line);
  }

  if (inFence) {
    out.push(openingLine, ...blockLines);
  }

  return {
    content: out.join("\n"),
    stats,
  };
}

function processFence({ openingLine, openingInfo, block, inputPath, stats }) {
  if (!shouldAttemptTranspile(openingInfo, block)) {
    stats.skipped += 1;
    return [openingLine, block, "```"];
  }

  stats.attempted += 1;
  const transpiled = transpileSnippet(block, inputPath);

  if (!transpiled.ok) {
    stats.failed += 1;
    return ["<!-- transpile failed -->", openingLine, block, "```"];
  }

  if (transpiled.output === block) {
    stats.skipped += 1;
  } else {
    stats.converted += 1;
  }

  return [openingLine, transpiled.output, "```"];
}

function shouldAttemptTranspile(openingInfo, block) {
  const infoParts = openingInfo
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  if (infoParts.includes("kcl") || infoParts.includes("norun")) {
    return true;
  }

  if (openingInfo !== "") {
    return false;
  }

  return looksLikeKcl(block);
}

function looksLikeKcl(block) {
  return (
    /(^|\n)\s*fn\s+\w+/m.test(block) ||
    /(^|\n)\s*@settings\b/m.test(block) ||
    /(^|\n)\s*(export\s+)?import\b/m.test(block) ||
    /(^|\n)\s*return\b/m.test(block) ||
    /(^|\n)\s*[A-Za-z_][A-Za-z0-9_]*\s*=/m.test(block) ||
    /\|>/.test(block) ||
    /\bstartSketchOn\s*\(/.test(block)
  );
}

function transpileSnippet(block, inputPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kcl-docs-transpile-"));
  const tempFile = path.join(tempDir, "snippet.kcl");
  fs.writeFileSync(tempFile, block);

  const result = spawnSync(transpileBin, ["convert", tempFile], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  fs.rmSync(tempDir, { recursive: true, force: true });

  if (result.status !== 0) {
    return {
      ok: false,
      error:
        result.stderr ||
        result.stdout ||
        `transpile exited with ${result.status}`,
    };
  }

  return {
    ok: true,
    output: stripTrailingNewline(result.stdout),
  };
}

function walkMarkdownFiles(root) {
  const results = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

function firstExistingPath(paths) {
  return paths.find((candidate) => fs.existsSync(candidate));
}

function stripTrailingNewline(text) {
  return text.replace(/\n$/, "");
}
