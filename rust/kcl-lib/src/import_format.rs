use std::str::FromStr;

use kittycad_modeling_cmds::shared::FileImportFormat;

/// Supported file extensions and the import formats they may contain.
///
/// Creo and NX both use `.prt`. NX is listed first so it is the default when the
/// format is inferred from an unversioned file path. Creo can be selected
/// explicitly with an import annotation, and versioned `.prt.N` paths are always
/// Creo.
pub(crate) const IMPORT_FILE_EXTENSION_FORMATS: &[(&str, &[FileImportFormat])] = &[
    ("sat", &[FileImportFormat::Acis]),
    ("sab", &[FileImportFormat::Acis]),
    ("catpart", &[FileImportFormat::Catia]),
    ("prt", &[FileImportFormat::Nx, FileImportFormat::Creo]),
    ("fbx", &[FileImportFormat::Fbx]),
    ("fbxb", &[FileImportFormat::Fbx]),
    ("gltf", &[FileImportFormat::Gltf]),
    ("glb", &[FileImportFormat::Gltf]),
    ("ipt", &[FileImportFormat::Inventor]),
    ("obj", &[FileImportFormat::Obj]),
    ("x_t", &[FileImportFormat::Parasolid]),
    ("x_b", &[FileImportFormat::Parasolid]),
    ("ply", &[FileImportFormat::Ply]),
    ("sldprt", &[FileImportFormat::Sldprt]),
    ("step", &[FileImportFormat::Step]),
    ("stp", &[FileImportFormat::Step]),
    ("stl", &[FileImportFormat::Stl]),
];

fn formats_for_extension(extension: &str) -> Option<&'static [FileImportFormat]> {
    IMPORT_FILE_EXTENSION_FORMATS
        .iter()
        .find_map(|(candidate, formats)| (*candidate == extension).then_some(*formats))
}

fn extension_from_path(path: &str) -> Option<String> {
    let file_name = path.rsplit(['/', '\\']).next()?;
    let (stem, extension) = file_name.rsplit_once('.')?;
    (!stem.is_empty()).then(|| extension.to_ascii_lowercase())
}

/// Parse a canonical import format identifier or a supported file extension.
pub(crate) fn import_format_from_name(name: &str) -> Option<FileImportFormat> {
    let name = name.to_ascii_lowercase();
    formats_for_extension(&name)
        .and_then(|formats| formats.first().copied())
        .or_else(|| FileImportFormat::from_str(&name).ok())
}

/// Whether a path names a Creo part file.
///
/// Creo part files end in `.prt` or a positive numeric version such as
/// `.prt.1`. Matching is case-insensitive and applies to the complete basename,
/// rather than only the final path extension.
fn is_creo_import_path(path: &str) -> bool {
    let Some(file_name) = path.rsplit(['/', '\\']).next() else {
        return false;
    };
    let file_name = file_name.to_ascii_lowercase();
    let Some((stem, suffix)) = file_name.rsplit_once(".prt") else {
        return false;
    };
    if stem.is_empty() {
        return false;
    }
    if suffix.is_empty() {
        return true;
    }

    let Some(version) = suffix.strip_prefix('.') else {
        return false;
    };
    let mut digits = version.chars();
    digits.next().is_some_and(|first| matches!(first, '1'..='9')) && digits.all(|digit| digit.is_ascii_digit())
}

/// Classify an import path by its complete filename.
pub(crate) fn import_format_from_path(path: &str) -> Option<FileImportFormat> {
    if let Some(format) = extension_from_path(path)
        .and_then(|extension| formats_for_extension(&extension))
        .and_then(|formats| formats.first().copied())
    {
        return Some(format);
    }

    is_creo_import_path(path).then_some(FileImportFormat::Creo)
}

/// Whether a file path can contain the given import format.
pub(crate) fn import_path_supports_format(path: &str, format: FileImportFormat) -> bool {
    if format == FileImportFormat::Creo && is_creo_import_path(path) {
        return true;
    }

    extension_from_path(path)
        .and_then(|extension| formats_for_extension(&extension))
        .is_some_and(|formats| formats.contains(&format))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_creo_part_paths() {
        for path in [
            "part.prt",
            "part.prt.1",
            "part.prt.23",
            "parts/nested/part.PRT",
            r"C:\parts\nested\part.PrT.3",
        ] {
            assert!(is_creo_import_path(path), "expected `{path}` to match");
        }
    }

    #[test]
    fn rejects_non_creo_part_paths() {
        for path in [
            "partprt",
            "partprt.1",
            ".prt",
            ".prt.1",
            "part.prt.0",
            "part.prt.01",
            "part.prt.-1",
            "part.prt.foo",
            "part.prt.1.bak",
        ] {
            assert!(!is_creo_import_path(path), "expected `{path}` not to match");
        }
    }

    #[test]
    fn recognizes_creo_format_name_and_import_paths() {
        assert_eq!(import_format_from_name("creo"), Some(FileImportFormat::Creo));
        assert_eq!(import_format_from_path("part.prt.42"), Some(FileImportFormat::Creo));
    }

    #[test]
    fn classifies_existing_import_extensions_and_aliases() {
        for (path, expected) in [
            ("part.step", FileImportFormat::Step),
            ("part.stp", FileImportFormat::Step),
            ("part.glb", FileImportFormat::Gltf),
            ("part.fbxb", FileImportFormat::Fbx),
            ("part.sldprt", FileImportFormat::Sldprt),
        ] {
            assert_eq!(
                import_format_from_path(path),
                Some(expected),
                "unexpected format for `{path}`"
            );
        }
    }

    #[test]
    fn classifies_proprietary_part_extensions() {
        for (path, expected) in [
            ("part.sat", FileImportFormat::Acis),
            ("part.sab", FileImportFormat::Acis),
            ("part.CATPart", FileImportFormat::Catia),
            ("part.ipt", FileImportFormat::Inventor),
            ("part.x_t", FileImportFormat::Parasolid),
            ("part.x_b", FileImportFormat::Parasolid),
            ("part.sldprt", FileImportFormat::Sldprt),
        ] {
            assert_eq!(
                import_format_from_path(path),
                Some(expected),
                "unexpected format for `{path}`"
            );
        }
    }

    #[test]
    fn unversioned_prt_supports_creo_and_nx() {
        assert_eq!(import_format_from_path("part.prt"), Some(FileImportFormat::Nx));
        assert!(import_path_supports_format("part.prt", FileImportFormat::Creo));
        assert!(import_path_supports_format("part.prt", FileImportFormat::Nx));
        assert!(!import_path_supports_format("part.prt.1", FileImportFormat::Nx));
    }
}
