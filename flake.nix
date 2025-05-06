{
  description = "zoo.dev modeling-app";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    naersk.url = "github:nix-community/naersk";
  };

  outputs = {
    self,
    nixpkgs,
    rust-overlay,
    naersk,
  }: let
    overlays = [
      (import rust-overlay)
      (self: super: {
        rustToolchain = super.rust-bin.stable.latest.default.override {
          targets = ["wasm32-unknown-unknown"];
          extensions = ["rustfmt" "llvm-tools-preview" "rust-src"];
        };

        # stand-alone nightly formatter so we get the fancy unstable flags
        nightlyRustfmt = super.rust-bin.selectLatestNightlyWith (toolchain:
          toolchain.default.override {
            extensions = ["rustfmt"]; # just the formatter
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
          };
          system = system;
        });
  in {
    devShells = forAllSystems ({pkgs, ...}: {
      default = pkgs.mkShell {
        packages =
          (with pkgs; [
            rustToolchain
            nightlyRustfmt
            cargo-criterion
            cargo-nextest
            cargo-sort
            just
            postgresql.lib
            openssl
            pkg-config
            nodejs_22
            electron
            playwright-driver.browsers
            firefox
            geckodriver
            wasm-pack
            python3Full
          ])
          ++ pkgs.lib.optionals pkgs.stdenv.isDarwin (with pkgs; [
            libiconv
            darwin.apple_sdk.frameworks.Security
          ]);

        TARGET_CC = "${pkgs.stdenv.cc}/bin/${pkgs.stdenv.cc.targetPrefix}cc";
        LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
        ELECTRON_OVERRIDE_DIST_PATH =
          if pkgs.stdenv.isDarwin
          then "${pkgs.electron}/Applications"
          else "${pkgs.electron}/bin";
        PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = true;
        PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.playwright-driver.browsers}/chromium-1091/chrome-linux/chrome";
        PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
        NODE_ENV = "development";
        RUSTFMT = "${pkgs.nightlyRustfmt}/bin/rustfmt";
        GECKODRIVER = "${pkgs.geckodriver}/bin/geckodriver";
      };
    });

    packages = forAllSystems ({
      pkgs,
      system,
    }: let
      naersk-lib = pkgs.callPackage naersk {
        cargo = pkgs.rustToolchain;
        rustc = pkgs.rustToolchain;
      };
    in {
      kcl-language-server = naersk-lib.buildPackage {
        pname = "kcl-language-server";
        version = "0.1.0";
        release = true;

        src = ./rust;

        cargoBuildOptions = opt: opt ++ ["-p" "kcl-language-server"];
        buildInputs = [pkgs.openssl pkgs.pkg-config];
      };
      default = self.packages.${system}.kcl-language-server;
    });
  };
}
