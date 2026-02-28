// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "pi",
  tagline: "AI coding agent",
  url: "https://pi.dev",
  baseUrl: "/docs/",
  onBrokenLinks: "warn",
  favicon: "img/favicon.ico",

  markdown: {
    // Use standard Markdown (not MDX) so raw HTML like <img> inside <a>
    // is accepted without requiring JSX-compatible self-closing tags.
    format: "md",
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: false,
        blog: false,
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      }),
    ],
  ],

  themes: [
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        docsDir: "../packages/coding-agent",
        docsRouteBasePath: "/",
        indexBlog: false,
      },
    ],
  ],

  plugins: [
    [
      "@docusaurus/plugin-content-docs",
      {
        id: "default",
        path: "../packages/coding-agent",
        routeBasePath: "/",
        sidebarPath: require.resolve("./sidebars.js"),
        exclude: [
          "src/**",
          "dist/**",
          "test/**",
          "node_modules/**",
          "**/node_modules/**",
          "examples/extensions/subagent/agents/**",
          "examples/extensions/subagent/prompts/**",
          "examples/extensions/dynamic-resources/SKILL.md",
          "examples/extensions/dynamic-resources/dynamic.md",
        ],
        beforeDefaultRemarkPlugins: [
          require("./src/plugins/remark-resolve-links"),
        ],
      },
    ],
  ],
};

module.exports = config;
