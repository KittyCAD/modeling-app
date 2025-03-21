.PHONY: all
all: install build check

###############################################################################
# INSTALL

WASM_PACK ?= ~/.cargo/bin/wasm-pack

.PHONY: install
install: node_modules/.yarn-integrity $(WASM_PACK) ## Install dependencies

node_modules/.yarn-integrity: package.json yarn.lock
	yarn install
	@ touch $@

$(WASM_PACK):
	yarn install:rust
	yarn install:wasm-pack:sh

###############################################################################
# BUILD

CARGO_SOURCES := rust/.cargo/config.toml $(wildcard rust/Cargo.*) $(wildcard rust/**/Cargo.*)
RUST_SOURCES := $(wildcard rust/**/*.rs)

REACT_SOURCES := $(wildcard src/*.tsx) $(wildcard src/**/*.tsx)
TYPESCRIPT_SOURCES := tsconfig.* $(wildcard src/*.ts) $(wildcard src/**/*.ts)
VITE_SOURCES := $(wildcard vite.*) $(wildcard vite/**/*.tsx)

.PHONY: build
build: build-web build-desktop

.PHONY: build-web
build-web: public/kcl_wasm_lib_bg.wasm build/index.html

.PHONY: build-desktop
build-desktop: public/kcl_wasm_lib_bg.wasm .vite/build/main.js

public/kcl_wasm_lib_bg.wasm: $(CARGO_SOURCES)$(RUST_SOURCES)
	yarn build:wasm

build/index.html: $(REACT_SOURCES) $(TYPESCRIPT_SOURCES) $(VITE_SOURCES)
	yarn build:local

.vite/build/main.js: $(REACT_SOURCES) $(TYPESCRIPT_SOURCES) $(VITE_SOURCES)
	yarn tronb:vite:dev

###############################################################################
# CHECK

.PHONY: check
check: format lint

.PHONY: format
format: install ## Format the code
	yarn fmt

.PHONY: lint
lint: install ## Lint the code
	yarn tsc
	yarn lint

###############################################################################
# RUN

.PHONY: run
run: run-web

.PHONY: run-web
run-web: install build-web ## Start the web app
	yarn start

.PHONY: run-desktop
run-desktop: install build-desktop ## Start the desktop app
	yarn tron:start

###############################################################################
# TEST

E2E_WORKERS ?= 1
E2E_FAILURES ?= 1
E2E_GREP ?= ""

.PHONY: test
test: test-unit test-e2e

.PHONY: test-unit
test-unit: install ## Run the unit tests
	@ nc -z localhost 3000 || ( echo "Error: localhost:3000 not available, 'make run-web' first" && exit 1 )
	yarn test:unit

.PHONY: test-e2e
test-e2e: test-e2e-desktop

.PHONY: test-e2e-web
test-e2e-web: install build-web ## Run the web e2e tests
	@ nc -z localhost 3000 || ( echo "Error: localhost:3000 not available, 'make run-web' first" && exit 1 )
	yarn chrome:test --headed --workers=$(E2E_WORKERS) --max-failures=$(E2E_FAILURES) --grep=$(E2E_GREP)

.PHONY: test-e2e-desktop
test-e2e-desktop: install build-desktop ## Run the desktop e2e tests
	yarn test:playwright:electron --workers=$(E2E_WORKERS) --max-failures=$(E2E_FAILURES) --grep=$(E2E_GREP)

###############################################################################
# CLEAN

.PHONY: clean
clean: ## Delete all artifacts
	rm -rf .vite/ build/
	rm -rf trace.zip playwright-report/ test-results/
	rm -rf public/kcl_wasm_lib_bg.wasm
	rm -rf rust/*/bindings/ rust/*/pkg/ rust/target/
	rm -rf node_modules/ rust/*/node_modules/

.PHONY: help
help: install
	@ grep -E '^[^[:space:]]+:.*## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

###############################################################################

# I'm sorry this is so specific to my setup you may as well ignore this.
# This is so you don't have to deal with electron windows popping up constantly.
# It should work for you other Linux users.
lee-electron-test:
	Xephyr -br -ac -noreset -screen 1200x500 :2 &
	DISPLAY=:2 NODE_ENV=development PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:4444/ yarn tron:test -g "when using the file tree"
	killall Xephyr
