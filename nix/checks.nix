{
  pkgs,
  pi,
  treefmtWrapper,
  source,
  nodejs,
}:
{
  package = pi;

  smoke =
    pkgs.runCommand "pi-smoke-test"
      {
        nativeBuildInputs = [ pi ];
      }
      ''
        export HOME=$(mktemp -d)
        pi --version
        pi --help > /dev/null
        touch $out
      '';

  formatting =
    pkgs.runCommand "pi-formatting-check"
      {
        nativeBuildInputs = [
          treefmtWrapper
          pkgs.git
        ];
      }
      ''
        export HOME=$(mktemp -d)
        mkdir repo && cd repo
        cp -r ${source}/. .
        chmod -R +w .
        git init -q
        git config user.email "test@example.com"
        git config user.name "Test"
        git add .
        treefmt --ci
        touch $out
      '';

  repo-hygiene =
    pkgs.runCommand "pi-repo-hygiene-check"
      {
        nativeBuildInputs = [ nodejs ];
      }
      ''
        cd ${source}
        node scripts/check-pinned-deps.mjs
        node scripts/check-entry-graphs.mjs
        node scripts/generate-coding-agent-install-lock.mjs --check
        touch $out
      '';
}
