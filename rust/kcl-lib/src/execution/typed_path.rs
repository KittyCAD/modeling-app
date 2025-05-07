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
        #[cfg(target_arch = "wasm32")]
        {
            TypedPath(typed_path::TypedPath::derive(path).to_path_buf())
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            TypedPath(std::path::PathBuf::from(path))
        }
    }
}

impl From<&str> for TypedPath {
    fn from(path: &str) -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            TypedPath(typed_path::TypedPath::derive(path).to_path_buf())
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            TypedPath(std::path::PathBuf::from(path))
        }
    }
}

impl TypedPath {
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

    fn output_path() -> Option<&'static std::path::Path> {
        std::path::PathBuf::output_path()
    }
}

impl schemars::JsonSchema for TypedPath {
    fn schema_name() -> String {
        "TypedPath".to_owned()
    }

    fn json_schema(gen: &mut schemars::gen::SchemaGenerator) -> schemars::schema::Schema {
        // TODO: Actually generate a reasonable schema.
        gen.subschema_for::<std::path::PathBuf>()
    }
}
