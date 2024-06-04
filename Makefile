.PHONY: dev

WASM_LIB_FILES := $(wildcard src/wasm-lib/**/*.rs)

dev: node_modules public/wasm_lib_bg.wasm
	yarn start

public/wasm_lib_bg.wasm: $(WASM_LIB_FILES)
	yarn build:wasm-dev

node_modules: package.json

package.json:
	yarn install
