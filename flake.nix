{
  description = "zoo.dev modeling-app";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = {
    self,
    nixpkgs,
    rust-overlay,
  }: let
    overlays = [
      (import rust-overlay)
      (self: super: {
        rustToolchain = super.rust-bin.stable.latest.default.override {
          targets = ["wasm32-unknown-unknown"];
          extensions = ["rustfmt" "llvm-tools-preview" "rust-src"];
        };
      })
      (self: super: {
        cargo-llvm-cov = super.cargo-llvm-cov.overrideAttrs (oa: {
          doCheck = false;
          doInstallCheck = false;
        });
      })
    ];

    allSystems = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];

    forAllSystems = f:
      nixpkgs.lib.genAttrs allSystems (system:
        f {
          pkgs = import nixpkgs {
            inherit overlays system;
            config.allowBroken = true;
          };
          system = system;
        });
  in {
    devShells = forAllSystems ({pkgs, ...}: {
      default = pkgs.mkShell {
        packages =
          (with pkgs; [
            rustToolchain
            cargo-llvm-cov
            cargo-nextest
            just
            postgresql.lib
            openssl
            pkg-config
            nodejs_22
            yarn
            electron
            playwright-driver.browsers
            wasm-pack
            python3Full
          ])
          ++ pkgs.lib.optionals pkgs.stdenv.isDarwin (with pkgs; [
            libiconv
            darwin.apple_sdk.frameworks.Security
          ]);

        TARGET_CC = "${pkgs.stdenv.cc}/bin/${pkgs.stdenv.cc.targetPrefix}cc";
        LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
        ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron}/bin/";
        PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = true;
        PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.playwright-driver.browsers}/chromium-1091/chrome-linux/chrome";
        PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
        NODE_ENV = "development";
      };
    });

    packages = forAllSystems ({
      pkgs,
      system,
    }: {
      kcl-language-server = pkgs.stdenv.mkDerivation {
        pname = "kcl-language-server";
        version = "0.1.0";

        src = ./.;

        buildInputs = [
          pkgs.rustToolchain
          pkgs.pkg-config
          pkgs.openssl
        ];

        buildPhase = ''
          cd rust
          cargo build --release -p kcl-language-server
        '';

        installPhase = ''
          mkdir -p $out/bin
          cp rust/target/release/kcl-language-server $out/bin/
        '';

        nativeBuildInputs = [pkgs.rustToolchain];
      };
      default = self.packages.${system}.kcl-language-server;
    });
  };
}
