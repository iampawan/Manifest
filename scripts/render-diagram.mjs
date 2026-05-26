#!/usr/bin/env node
// Render a contract's Mermaid diagrams to a standalone HTML you can open
// in any browser — so you can SEE the diagram even if the .md never lands
// on GitHub and your IDE's markdown preview doesn't do Mermaid.
//
// Dependency-free: it extracts the ```mermaid blocks and drops them into
// an HTML page that loads Mermaid from a CDN (needs network when you
// OPEN the file; nothing is fetched at generate time).
//
// Usage:
//   node render-diagram.mjs <contract.md>            # writes <contract>.diagram.html
//   node render-diagram.mjs <contract.md> --print    # print the HTML to stdout

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

// Pure + testable: pull every ```mermaid fenced block out of the markdown.
export function extractMermaid(md) {
  const blocks = [];
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) blocks.push(m[1].replace(/\s+$/, ""));
  return blocks;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderHtml(md, title = "Contract diagrams") {
  const blocks = extractMermaid(md);
  const body = blocks.length
    ? blocks.map((b) => `  <div class="mermaid">\n${esc(b)}\n  </div>`).join("\n")
    : `  <p>No Mermaid diagrams found in this contract.</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>body{font:14px system-ui,sans-serif;margin:2rem;max-width:1000px}
.mermaid{margin:1.5rem 0;padding:1rem;border:1px solid #ddd;border-radius:8px}</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true });</script>
</head><body>
<h1>${esc(title)}</h1>
${body}
</body></html>
`;
}

function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error("usage: render-diagram.mjs <contract.md> [--print]");
    process.exit(1);
  }
  const md = readFileSync(file, "utf8");
  const html = renderHtml(md, `Diagrams — ${basename(file, ".md")}`);
  if (flags.includes("--print")) {
    process.stdout.write(html);
    return;
  }
  const out = file.replace(/\.md$/, "") + ".diagram.html";
  writeFileSync(out, html);
  const n = extractMermaid(md).length;
  console.error(`Wrote ${out} (${n} diagram${n === 1 ? "" : "s"}). Open it in a browser to view.`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
