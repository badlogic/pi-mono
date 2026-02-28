// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    { type: "doc", id: "README", label: "Overview" },
    {
      type: "category",
      label: "Guides",
      items: [
        "docs/providers",
        "docs/models",
        "docs/settings",
        "docs/keybindings",
        "docs/session",
        "docs/compaction",
        "docs/prompt-templates",
        "docs/skills",
        "docs/windows",
        "docs/termux",
        "docs/terminal-setup",
        "docs/shell-aliases",
      ],
    },
    {
      type: "category",
      label: "Extending",
      items: [
        "docs/extensions",
        "docs/tui",
        "docs/themes",
        "docs/packages",
        "docs/custom-provider",
      ],
    },
    {
      type: "category",
      label: "Integration",
      items: ["docs/sdk", "docs/rpc", "docs/json"],
    },
    {
      type: "category",
      label: "Examples",
      items: [
        "examples/README",
        "examples/extensions/README",
        "examples/extensions/doom-overlay/README",
        "examples/extensions/plan-mode/README",
        "examples/extensions/subagent/README",
        "examples/sdk/README",
      ],
    },
    { type: "doc", id: "docs/development", label: "Development" },
    { type: "doc", id: "CHANGELOG", label: "Changelog" },
  ],
};

module.exports = sidebars;
