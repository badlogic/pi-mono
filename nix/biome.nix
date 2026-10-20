{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
}:
stdenv.mkDerivation (finalAttrs: {
  pname = "biome";
  version = "2.3.5";

  src =
    finalAttrs.passthru.sources.${stdenv.hostPlatform.system}
      or (throw "Unsupported system for Biome: ${stdenv.hostPlatform.system}");

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  installPhase = ''
    runHook preInstall
    install -Dm755 biome $out/bin/biome
    runHook postInstall
  '';

  passthru.sources = {
    x86_64-linux = fetchurl {
      url = "https://registry.npmjs.org/@biomejs/cli-linux-x64/-/cli-linux-x64-${finalAttrs.version}.tgz";
      hash = "sha256-2k7rG5YgEyMtJ7jAI+JWPzWhdxlNZI6TqyMVngU9Dus=";
    };
    aarch64-linux = fetchurl {
      url = "https://registry.npmjs.org/@biomejs/cli-linux-arm64/-/cli-linux-arm64-${finalAttrs.version}.tgz";
      hash = "sha256-cLKXQ7uIyS2aQ7P95IHh7A7hI7z89p8WUKeYW3/4N/I=";
    };
    x86_64-darwin = fetchurl {
      url = "https://registry.npmjs.org/@biomejs/cli-darwin-x64/-/cli-darwin-x64-${finalAttrs.version}.tgz";
      hash = "sha256-cD7JJVxSXEAQnYSgWAbOC1EPJ+M0+q7h0xg57OXao4o=";
    };
    aarch64-darwin = fetchurl {
      url = "https://registry.npmjs.org/@biomejs/cli-darwin-arm64/-/cli-darwin-arm64-${finalAttrs.version}.tgz";
      hash = "sha256-sMi2Aywy3UnD9hQPyroTMPfCsFSZKRqqnb8uC5oNX34=";
    };
  };

  meta = {
    description = "Toolchain of the web";
    homepage = "https://biomejs.dev/";
    license = lib.licenses.mit;
    platforms = builtins.attrNames finalAttrs.passthru.sources;
    mainProgram = finalAttrs.pname;
  };
})
