{
  description = "modeling-app development environment";

  # Flake inputs
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay"; # A helper for Rust + Nix
  };

  # Flake outputs
  outputs = { self, nixpkgs, rust-overlay }:
    let
      # Overlays enable you to customize the Nixpkgs attribute set
      overlays = [
        # Makes a `rust-bin` attribute available in Nixpkgs
        (import rust-overlay)
        # Provides a `rustToolchain` attribute for Nixpkgs that we can use to
        # create a Rust environment
        (self: super: {
          rustToolchain = super. rust-bin.stable.latest.default.override {
            targets = [ "wasm32-unknown-unknown" ];
            extensions = [ "rustfmt" "llvm-tools-preview" ];
          };
        })
      ];

      # Systems supported
      allSystems = [
        "x86_64-linux" # 64-bit Intel/AMD Linux
        "aarch64-linux" # 64-bit ARM Linux
        "x86_64-darwin" # 64-bit Intel macOS
        "aarch64-darwin" # 64-bit ARM macOS
      ];

      # Helper to provide system-specific attributes
      forAllSystems = f: nixpkgs.lib.genAttrs allSystems (system: f {
        pkgs = import nixpkgs { inherit overlays system; };
      });

    in
    {
      # Development environment output
      devShells = forAllSystems ({ pkgs }: {
        default = pkgs.mkShell {
          # The Nix packages provided in the environment
          packages = (with pkgs; [
            # The package provided by our custom overlay. Includes cargo, Clippy, cargo-fmt,
            # rustdoc, rustfmt, and other tools.
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
          ]) ++ pkgs.lib.optionals pkgs.stdenv.isDarwin (with pkgs; [
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
    };
}
