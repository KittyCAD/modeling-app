use std::sync::LazyLock;

pub struct MemoryWorkload {
    pub name: &'static str,
    pub source: fn() -> &'static str,
}

pub const WORKLOADS: &[MemoryWorkload] = &[
    MemoryWorkload {
        name: "many_closure_snapshots",
        source: many_closure_snapshots,
    },
    MemoryWorkload {
        name: "many_bindings_and_lookups",
        source: many_bindings_and_lookups,
    },
    MemoryWorkload {
        name: "shadowed_function_calls",
        source: shadowed_function_calls,
    },
    MemoryWorkload {
        name: "function_chain_calls",
        source: function_chain_calls,
    },
    MemoryWorkload {
        name: "wide_object_access",
        source: wide_object_access,
    },
    MemoryWorkload {
        name: "array_index_lookups",
        source: array_index_lookups,
    },
    MemoryWorkload {
        name: "std_prelude_lookups",
        source: std_prelude_lookups,
    },
];

static MANY_CLOSURE_SNAPSHOTS: LazyLock<String> = LazyLock::new(|| {
    let mut code = String::from("seed = 1\n");
    for i in 0..400 {
        code.push_str(&format!(
            "fn closure{i}() {{\n  return seed\n}}\nfuture{i} = {i}\nresult{i} = closure{i}()\n"
        ));
    }
    code
});

static MANY_BINDINGS_AND_LOOKUPS: LazyLock<String> = LazyLock::new(|| {
    let mut code = String::new();
    code.push_str("value0 = 0\n");
    for i in 1..2000 {
        code.push_str(&format!("value{i} = value{} + 1\n", i - 1));
    }
    code.push_str("result = value1999\n");
    code
});

static SHADOWED_FUNCTION_CALLS: LazyLock<String> = LazyLock::new(|| {
    let mut code = String::from("shared = 1\n");
    for i in 0..300 {
        code.push_str(&format!(
            "fn useShared{i}(input) {{\n  shared = input + {i}\n  return shared\n}}\n"
        ));
    }
    for i in 0..300 {
        code.push_str(&format!("call{i} = useShared{i}(input = {i})\n"));
    }
    code
});

static FUNCTION_CHAIN_CALLS: LazyLock<String> = LazyLock::new(|| {
    let mut code = String::from("value0 = 0\n");
    for i in 0..300 {
        code.push_str(&format!("fn step{i}(input) {{\n  return input + 1\n}}\n"));
    }
    for i in 0..300 {
        code.push_str(&format!("value{} = step{i}(input = value{i})\n", i + 1));
    }
    code.push_str("result = value300\n");
    code
});

static WIDE_OBJECT_ACCESS: LazyLock<String> = LazyLock::new(|| {
    let mut code = String::from("wide = {\n");
    for i in 0..300 {
        code.push_str(&format!("  field{i} = {i},\n"));
    }
    code.push_str("}\n");
    code.push_str("copy0 = wide\n");
    for i in 1..150 {
        code.push_str(&format!("copy{i} = copy{}\n", i - 1));
    }
    for i in 0..300 {
        code.push_str(&format!("value{i} = copy149.field{i}\n"));
    }
    code.push_str("result = value299\n");
    code
});

static ARRAY_INDEX_LOOKUPS: LazyLock<String> = LazyLock::new(|| {
    let mut code = String::from("items = [\n");
    for i in 0..1000 {
        code.push_str(&format!("  {i},\n"));
    }
    code.push_str("]\n");
    for i in 0..1000 {
        code.push_str(&format!("value{i} = items[{i}]\n"));
    }
    code.push_str("result = value999\n");
    code
});

static STD_PRELUDE_LOOKUPS: LazyLock<String> = LazyLock::new(|| {
    let mut code = String::new();
    for i in 0..1000 {
        let radicand = i + 1;
        code.push_str(&format!("value{i} = sqrt({radicand}) + PI\n"));
    }
    code.push_str("result = value999\n");
    code
});

#[allow(dead_code)]
pub fn workload_source(name: &str) -> Option<&'static str> {
    WORKLOADS
        .iter()
        .find(|workload| workload.name == name)
        .map(|workload| (workload.source)())
}

fn many_closure_snapshots() -> &'static str {
    MANY_CLOSURE_SNAPSHOTS.as_str()
}

fn many_bindings_and_lookups() -> &'static str {
    MANY_BINDINGS_AND_LOOKUPS.as_str()
}

fn shadowed_function_calls() -> &'static str {
    SHADOWED_FUNCTION_CALLS.as_str()
}

fn function_chain_calls() -> &'static str {
    FUNCTION_CHAIN_CALLS.as_str()
}

fn wide_object_access() -> &'static str {
    WIDE_OBJECT_ACCESS.as_str()
}

fn array_index_lookups() -> &'static str {
    ARRAY_INDEX_LOOKUPS.as_str()
}

fn std_prelude_lookups() -> &'static str {
    STD_PRELUDE_LOOKUPS.as_str()
}
