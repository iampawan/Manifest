// Unit tests for the diagram renderer (scripts/render-diagram.mjs).
// The extraction is pure code, so it's exact-match testable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMermaid, renderHtml } from "../scripts/render-diagram.mjs";

const MD = `---
id: X
---
## Goal
text
## Diagrams
\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`
more text
\`\`\`mermaid
sequenceDiagram
  A->>B: hi
\`\`\`
`;

test("extractMermaid: pulls every fenced mermaid block in order", () => {
  const blocks = extractMermaid(MD);
  assert.equal(blocks.length, 2);
  assert.ok(blocks[0].includes("flowchart TD"));
  assert.ok(blocks[1].includes("sequenceDiagram"));
});

test("extractMermaid: returns empty for no diagrams", () => {
  assert.deepEqual(extractMermaid("# just text\nno diagrams here"), []);
});

test("renderHtml: embeds each block in a .mermaid div + loads mermaid", () => {
  const html = renderHtml(MD, "T");
  assert.ok(html.includes("mermaid.min.js"));
  assert.equal((html.match(/class="mermaid"/g) || []).length, 2);
  assert.ok(html.includes("flowchart TD"));
});

test("renderHtml: escapes HTML-special chars so they don't break the page", () => {
  const html = renderHtml("```mermaid\ngraph LR\n  A--> B & <C>\n```", "T");
  assert.ok(html.includes("&amp;") && html.includes("&lt;C&gt;"));
});

test("renderHtml: friendly message when there are no diagrams", () => {
  assert.ok(renderHtml("no diagrams").includes("No Mermaid diagrams found"));
});
