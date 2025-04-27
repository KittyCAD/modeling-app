use js_sys::Reflect;
use wasm_bindgen::JsValue;

/// returns true if globalThis.process?.env?.VITEST is truthy
fn is_vitest_by_env() -> bool {
    let global = js_sys::global();

    // global.process
    let process = Reflect::get(&global, &JsValue::from_str("process"))
        .ok()
        .unwrap_or_else(|| JsValue::NULL);
    // process.env
    let env = Reflect::get(&process, &JsValue::from_str("env"))
        .ok()
        .unwrap_or_else(|| JsValue::NULL);
    // env.VITEST
    let vitest = Reflect::get(&env, &JsValue::from_str("VITEST"))
        .ok()
        .unwrap_or_else(|| JsValue::NULL);

    // "true", "1", or a boolean
    vitest
        .as_bool()
        .unwrap_or_else(|| vitest.as_string().map_or(false, |s| s == "true" || s == "1"))
}

fn is_vitest_by_global() -> bool {
    let global = js_sys::global();
    Reflect::has(&global, &JsValue::from_str("__vitest_worker__")).unwrap_or(false)
}

pub fn running_in_vitest() -> bool {
    is_vitest_by_env() || is_vitest_by_global()
}
