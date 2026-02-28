// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");

const CONTENT_ROOT = path.resolve(__dirname, "../../../packages/coding-agent");

// ---------------------------------------------------------------------------
// Tree walker (replaces unist-util-visit which is ESM-only)
// ---------------------------------------------------------------------------

/**
 * Walk every node in the tree, calling visitor for each node.
 * visitor(node, parent, index) — may mutate parent.children.
 * We collect all matching link nodes first, then mutate, to avoid index drift.
 */
function collectLinks(tree) {
  const links = []; // { node, parent, index }

  function walk(node, parent, index) {
    if (node.type === "link") {
      links.push({ node, parent, index });
    }
    if (Array.isArray(node.children)) {
      // Walk in reverse so that forward indices in `links` stay valid after
      // splice operations; we'll sort at mutation time anyway.
      for (let i = 0; i < node.children.length; i++) {
        walk(node.children[i], node, i);
      }
    }
  }

  walk(tree, null, null);
  return links;
}

function isExternalUrl(href) {
  return /^https?:\/\//.test(href) || href.startsWith("//");
}

function isAnchorOnly(href) {
  return href.startsWith("#");
}

function isOutOfTreeOrSource(resolved) {
  if (
    !resolved.startsWith(CONTENT_ROOT + path.sep) &&
    resolved !== CONTENT_ROOT
  ) {
    return true;
  }
  const rel = path.relative(CONTENT_ROOT, resolved);
  return (
    rel.startsWith("src" + path.sep) ||
    rel.startsWith("test" + path.sep) ||
    rel.startsWith("dist" + path.sep) ||
    rel.startsWith("node_modules" + path.sep)
  );
}

function linkText(node) {
  const parts = [];
  function walk(n) {
    if (n.type === "text") parts.push(n.value);
    else if (Array.isArray(n.children)) n.children.forEach(walk);
  }
  walk(node);
  return parts.join("") || node.url;
}

/**
 * Build three sequential mdast nodes for a collapsible code embed:
 *
 * Keeping the TypeScript source in a `code` AST node rather than inside a
 * raw HTML string avoids MDX treating `${…}` template literals as JSX
 * interpolations, which caused SSG "Invalid tag" errors.
 */
function buildDetailsNodes(summaryText, fileContent) {
  return [
    {
      type: "html",
      value: `<details class="example-embed">\n<summary>${summaryText}</summary>`,
    },
    {
      type: "code",
      lang: "typescript",
      value: fileContent,
    },
    {
      type: "html",
      value: `</details>`,
    },
  ];
}

function stripLink(node, parent, index) {
  const children =
    Array.isArray(node.children) && node.children.length > 0
      ? node.children
      : [{ type: "text", value: node.url }];
  parent.children.splice(index, 1, ...children);
}

function remarkResolveLinks() {
  return function transformer(tree, vfile) {
    const sourceFile =
      vfile.path || (Array.isArray(vfile.history) ? vfile.history[0] : null);
    if (!sourceFile) return;

    const sourceDir = path.dirname(sourceFile);

    const toEmbed = []; // will be replaced with <details> blocks
    const toStrip = []; // will be unwrapped to plain text

    for (const { node, parent, index } of collectLinks(tree)) {
      const href = node.url;
      if (!href) continue;

      if (isAnchorOnly(href)) continue;

      if (isExternalUrl(href)) {
        if (
          href.includes("github.com") &&
          href.includes("/packages/coding-agent/src/")
        ) {
          toStrip.push({ node, parent, index });
        }
        continue;
      }

      if (href.endsWith("/")) {
        toStrip.push({ node, parent, index });
        continue;
      }

      const resolved = path.resolve(sourceDir, href);
      const relToRoot = path.relative(CONTENT_ROOT, resolved);

      if (
        resolved.endsWith(".ts") &&
        (relToRoot.startsWith("examples" + path.sep) ||
          relToRoot.startsWith("examples/")) &&
        !isOutOfTreeOrSource(resolved)
      ) {
        toEmbed.push({ node, parent, index });
        continue;
      }

      if (isOutOfTreeOrSource(resolved)) {
        toStrip.push({ node, parent, index });
        continue;
      }

      if (resolved.endsWith(".md") && !fs.existsSync(resolved)) {
        toStrip.push({ node, parent, index });
        continue;
      }
    }

    // Mutate in reverse-index order to avoid index-shift issues within the
    // same parent.children array.
    const allOps = [
      ...toEmbed.map((e) => ({ ...e, op: "embed" })),
      ...toStrip.map((e) => ({ ...e, op: "strip" })),
    ].sort((a, b) => b.index - a.index);

    for (const { op, node, parent, index } of allOps) {
      if (!parent || index === null || index === undefined) continue;

      if (op === "embed") {
        const resolved = path.resolve(sourceDir, node.url);
        let content;
        try {
          content = fs.readFileSync(resolved, "utf8");
        } catch {
          stripLink(node, parent, index);
          continue;
        }
        parent.children.splice(
          index,
          1,
          ...buildDetailsNodes(linkText(node), content),
        );
      } else {
        stripLink(node, parent, index);
      }
    }
  };
}

module.exports = remarkResolveLinks;
