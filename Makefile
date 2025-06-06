.PHONY: all

all: install check build

# INSTALL

``` :
ifeq ($(OS),Windows_NT)
  export WINDOWS := true
  ifndef MSYSTEM
    export POWERSHELL := true
  endif
endif
``` :

```:
ifdef WINDOWS
  CARGO ?= $(USERPROFILE)/.cargo/bin/cargo.exe
  WASM_PACK ?= $(USERPROFILE)/.cargo/bin/wasm-pack.exe
else
  CARGO ?= $(shell which cargo || echo ~/.cargo/bin/cargo)
  WASM_PACK ?= $(shell which wasm-pack || echo ~/.cargo/bin/wasm-pack)
endif
```:

.PHONY: install

### Install dependencies

install: node_modules/.package-lock.json $(CARGO) $(WASM_PACK)

node_modules/.package-lock.json: package.json package-lock.json
	npm prune
	npm install

$(CARGO):
ifdef WINDOWS
	npm run install:rust:windows
else
	npm run install:rust
endif

$(WASM_PACK):
ifdef WINDOWS
	npm run install:wasm-pack:cargo
else
	npm run install:wasm-pack:sh
endif

# BUILD

CARGO_SOURCES := rust/.cargo/config.toml $(wildcard rust/Cargo.*) $(wildcard rust/**/Cargo.*)
KCL_SOURCES := $(wildcard public/kcl-samples/**/*.kcl)
RUST_SOURCES := $(wildcard rust/**/*.rs)

REACT_SOURCES := $(wildcard src/*.tsx) $(wildcard src/**/*.tsx)
TYPESCRIPT_SOURCES := tsconfig.* $(wildcard src/*.ts) $(wildcard src/**/*.ts)
VITE_SOURCES := $(wildcard vite.*) $(wildcard vite/**/*.tsx)

.PHONY: build
build: install public/kcl_wasm_lib_bg.wasm public/kcl-samples/manifest.json .vite/build/main.js

public/kcl_wasm_lib_bg.wasm: $(CARGO_SOURCES) $(RUST_SOURCES)
ifdef WINDOWS
	npm run build:wasm:dev:windows
else
	npm run build:wasm:dev
endif

public/kcl-samples/manifest.json: $(KCL_SOURCES)
	cd rust/kcl-lib && EXPECTORATE=overwrite cargo test generate_manifest

.vite/build/main.js: $(REACT_SOURCES) $(TYPESCRIPT_SOURCES) $(VITE_SOURCES)
	npm run tronb:vite:dev

###############################################################################
# CHECK

.PHONY: check
check: format lint

.PHONY: format
format: install ## Format the code
	npm run fmt

.PHONY: lint
lint: install ## Lint the code
	npm run tsc
	npm run lint

###############################################################################
# RUN

TARGET ?= desktop

.PHONY: run
run: run-$(TARGET)

.PHONY: run-web
run-web: install build ## Start the web app
	npm run start

.PHONY: run-desktop
run-desktop: install build ## Start the desktop app
	npm run tron:start

###############################################################################
# TEST

E2E_GREP ?=
E2E_WORKERS ?=
E2E_FAILURES ?= 1

.PHONY: test
test: test-unit test-e2e

.PHONY: test-unit
test-unit: install ## Run the unit tests
	npm run test:rust
	npm run test:unit:components
	@ curl -fs localhost:3000 >/dev/null || ( echo "Error: localhost:3000 not available, 'make run-web' first" && exit 1 )
	npm run test:unit

.PHONY: test-e2e
test-e2e: test-e2e-$(TARGET)

.PHONY: test-e2e-web
test-e2e-web: install build ## Run the web e2e tests
ifdef E2E_GREP
	npm run test:e2e:web -- --headed --grep="$(E2E_GREP)" --max-failures=$(E2E_FAILURES)
else
	npm run test:e2e:web -- --headed --workers='100%'
endif

.PHONY: test-e2e-desktop
test-e2e-desktop: install build ## Run the desktop e2e tests
ifdef E2E_GREP
	npm run test:e2e:desktop -- --grep="$(E2E_GREP)" --max-failures=$(E2E_FAILURES)
else
	npm run test:e2e:desktop -- --workers='100%'
endif

###############################################################################
# CLEAN

.PHONY: clean
clean: ## Delete all artifacts
ifdef POWERSHELL
	git clean --force -d -x --exclude=.env* --exclude=**/*.env
else
	rm -rf .vite/ build/
	rm -rf trace.zip playwright-report/ test-results/
	rm -rf public/kcl_wasm_lib_bg.wasm
	rm -rf rust/*/bindings/ rust/*/pkg/ rust/target/
	rm -rf node_modules/ rust/*/node_modules/
endif

.PHONY: help
help: install
ifdef POWERSHELL
	@ powershell -Command "Get-Content $(MAKEFILE_LIST) | Select-String -Pattern '^[^\s]+:.*##\s.*$$' | ForEach-Object { $$line = $$_.Line -split ':.*?##\s+'; Write-Host -NoNewline $$line[0].PadRight(30) -ForegroundColor Cyan; Write-Host $$line[1] }"
else
	@ grep -E '^[^[:space:]]+:.*## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'
endif

.DEFAULT_GOAL := help

###############################################################################

# I'm sorry this is so specific to my setup you may as well ignore this.
# This is so you don't have to deal with electron windows popping up constantly.
# It should work for you other Linux users.
lee-electron-test:
	Xephyr -br -ac -noreset -screen 1200x500 :2 &
	DISPLAY=:2 NODE_ENV=development PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:4444/ npm run tron:test -g "when using the file tree"
	killall Xephyr
