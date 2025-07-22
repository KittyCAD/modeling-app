//! A typed path type so that in wasm we can track if its a windows or unix path.
//! On non-wasm platforms, this is just a std::path::PathBuf.

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TypedPath(
    #[cfg(target_arch = "wasm32")] pub typed_path::TypedPathBuf,
    #[cfg(not(target_arch = "wasm32"))] pub std::path::PathBuf,
);

impl std::fmt::Display for TypedPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        #[cfg(target_arch = "wasm32")]
        {
            self.0.to_path().display().fmt(f)
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.0.display().fmt(f)
        }
    }
}

impl Default for TypedPath {
    fn default() -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            TypedPath(typed_path::TypedPath::derive("").to_path_buf())
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            TypedPath(std::path::PathBuf::new())
        }
    }
}

impl From<&String> for TypedPath {
    fn from(path: &String) -> Self {
        TypedPath::new(path)
    }
}

impl From<&str> for TypedPath {
    fn from(path: &str) -> Self {
        TypedPath::new(path)
    }
}

impl TypedPath {
    pub fn new(path: &str) -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            TypedPath(typed_path::TypedPath::derive(path).to_path_buf())
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            TypedPath(normalise_import(path))
        }
    }

    pub fn extension(&self) -> Option<&str> {
        #[cfg(target_arch = "wasm32")]
        {
            self.0
                .extension()
                .map(|s| std::str::from_utf8(s).map(|s| s.trim_start_matches('.')).unwrap_or(""))
                .filter(|s| !s.is_empty())
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.0.extension().and_then(|s| s.to_str())
        }
    }

    pub fn join(&self, path: &str) -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            TypedPath(self.0.join(path))
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            TypedPath(self.0.join(path))
        }
    }

    pub fn join_typed(&self, path: &TypedPath) -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            TypedPath(self.0.join(path.0.to_path()))
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            TypedPath(self.0.join(&path.0))
        }
    }

    pub fn parent(&self) -> Option<Self> {
        #[cfg(target_arch = "wasm32")]
        {
            self.0.parent().map(|p| TypedPath(p.to_path_buf()))
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.0.parent().map(|p| TypedPath(p.to_path_buf()))
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn strip_prefix(&self, base: impl AsRef<std::path::Path>) -> Result<Self, std::path::StripPrefixError> {
        self.0.strip_prefix(base).map(|p| TypedPath(p.to_path_buf()))
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn canonicalize(&self) -> Result<Self, std::io::Error> {
        self.0.canonicalize().map(|p| TypedPath(p.to_path_buf()))
    }

    pub fn to_string_lossy(&self) -> String {
        #[cfg(target_arch = "wasm32")]
        {
            self.0.to_path().to_string_lossy().to_string()
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.0.to_string_lossy().to_string()
        }
    }

    pub fn display(&self) -> String {
        #[cfg(target_arch = "wasm32")]
        {
            self.0.to_path().display().to_string()
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.0.display().to_string()
        }
    }

    pub fn file_name(&self) -> Option<String> {
        #[cfg(target_arch = "wasm32")]
        {
            self.0
                .file_name()
                .map(|s| std::str::from_utf8(s).unwrap_or(""))
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.0.file_name().and_then(|s| s.to_str()).map(|s| s.to_string())
        }
    }
}

impl serde::Serialize for TypedPath {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[cfg(target_arch = "wasm32")]
        {
            self.0.to_str().serialize(serializer)
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.0.serialize(serializer)
        }
    }
}

impl<'de> serde::de::Deserialize<'de> for TypedPath {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[cfg(target_arch = "wasm32")]
        {
            let path: String = serde::Deserialize::deserialize(deserializer)?;
            Ok(TypedPath(typed_path::TypedPath::derive(&path).to_path_buf()))
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let path: std::path::PathBuf = serde::Deserialize::deserialize(deserializer)?;
            Ok(TypedPath(path))
        }
    }
}

impl ts_rs::TS for TypedPath {
    type WithoutGenerics = Self;
    type OptionInnerType = Self;

    fn name() -> String {
        "string".to_string()
    }

    fn decl() -> String {
        std::path::PathBuf::decl()
    }

    fn decl_concrete() -> String {
        std::path::PathBuf::decl_concrete()
    }

    fn inline() -> String {
        std::path::PathBuf::inline()
    }

    fn inline_flattened() -> String {
        std::path::PathBuf::inline_flattened()
    }

    fn output_path() -> Option<std::path::PathBuf> {
        std::path::PathBuf::output_path()
    }
}

impl schemars::JsonSchema for TypedPath {
    fn schema_name() -> String {
        "TypedPath".to_owned()
    }

    fn json_schema(r#gen: &mut schemars::r#gen::SchemaGenerator) -> schemars::schema::Schema {
        // TODO: Actually generate a reasonable schema.
        r#gen.subschema_for::<std::path::PathBuf>()
    }
}

/// Turn `nested\foo\bar\main.kcl` or `nested/foo/bar/main.kcl`
/// into a PathBuf that works on the host OS.
///
/// * Does **not** touch `..` or symlinks – call `canonicalize()` if you need that.
/// * Returns an owned `PathBuf` only when normalisation was required.
#[cfg(not(target_arch = "wasm32"))]
fn normalise_import<S: AsRef<str>>(raw: S) -> std::path::PathBuf {
    let s = raw.as_ref();
    // On Unix we need to swap `\` → `/`.  On Windows we leave it alone.
    // (Windows happily consumes `/`)
    if cfg!(unix) && s.contains('\\') {
        std::path::PathBuf::from(s.replace('\\', "/"))
    } else {
        std::path::Path::new(s).to_path_buf()
    }
}
