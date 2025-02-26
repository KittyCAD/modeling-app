.PHONY: dev

WASM_LIB_FILES := $(wildcard src/wasm-lib/**/*.rs)
TS_SRC := $(wildcard src/**/*.tsx) $(wildcard src/**/*.ts)
XSTATE_TYPEGENS := $(wildcard src/machines/*.typegen.ts)

dev: node_modules public/wasm_lib_bg.wasm $(XSTATE_TYPEGENS)
	pnpm start

# I'm sorry this is so specific to my setup you may as well ignore this.
# This is so you don't have to deal with electron windows popping up constantly.
# It should work for you other Linux users.
lee-electron-test:
	Xephyr -br -ac -noreset -screen 1200x500 :2 &
	DISPLAY=:2 NODE_ENV=development PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:4444/ pnpm tron:test -g "when using the file tree"
	killall Xephyr

$(XSTATE_TYPEGENS): $(TS_SRC)
	pnpm xstate typegen 'src/**/*.ts?(x)'

public/wasm_lib_bg.wasm: $(WASM_LIB_FILES)
	pnpm build:wasm

node_modules: package.json yarn.lock
	pnpm install
