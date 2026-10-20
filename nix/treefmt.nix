{ pkgs }:
pkgs.treefmt.withConfig {
  runtimeInputs = with pkgs; [
    biome
    nixfmt
  ];
  settings = {
    global.tree_root_file = "flake.nix";
    formatter = {
      biome = {
        command = "biome";
        options = [
          "format"
          "--write"
          "--no-errors-on-unmatched"
        ];
        includes = [
          "*.cjs"
          "*.css"
          "*.cts"
          "*.graphql"
          "*.js"
          "*.json"
          "*.jsonc"
          "*.mjs"
          "*.mts"
          "*.ts"
        ];
      };
      nixfmt = {
        command = "nixfmt";
        includes = [ "*.nix" ];
      };
    };
  };
}
