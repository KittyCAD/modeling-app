use std::path::Path;
use std::path::PathBuf;

pub const RENDERED_MODEL_NAME: &str = "rendered_model.png";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderArtifactKind {
    RenderedModel,
    V1RenderedModel,
    V2RenderedModel,
    Diff,
}

pub fn render_artifact_file_name(stem: Option<&str>, kind: RenderArtifactKind) -> String {
    let base_name = match kind {
        RenderArtifactKind::RenderedModel => RENDERED_MODEL_NAME.to_owned(),
        RenderArtifactKind::V1RenderedModel => format!("v1-{RENDERED_MODEL_NAME}"),
        RenderArtifactKind::V2RenderedModel => format!("v2-{RENDERED_MODEL_NAME}"),
        RenderArtifactKind::Diff => "diff.png".to_owned(),
    };

    match stem {
        Some(stem) => format!("{stem}-{base_name}"),
        None => base_name,
    }
}

pub fn render_artifact_path(out_dir: &Path, stem: Option<&str>, kind: RenderArtifactKind) -> PathBuf {
    out_dir.join(render_artifact_file_name(stem, kind))
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::path::PathBuf;

    use super::RENDERED_MODEL_NAME;
    use super::RenderArtifactKind;
    use super::render_artifact_file_name;
    use super::render_artifact_path;

    #[test]
    fn artifact_names_without_stem_match_expected_defaults() {
        assert_eq!(
            render_artifact_file_name(None, RenderArtifactKind::RenderedModel),
            RENDERED_MODEL_NAME
        );
        assert_eq!(
            render_artifact_file_name(None, RenderArtifactKind::V1RenderedModel),
            "v1-rendered_model.png"
        );
        assert_eq!(
            render_artifact_file_name(None, RenderArtifactKind::V2RenderedModel),
            "v2-rendered_model.png"
        );
        assert_eq!(render_artifact_file_name(None, RenderArtifactKind::Diff), "diff.png");
    }

    #[test]
    fn artifact_names_with_stem_are_prefixed() {
        assert_eq!(
            render_artifact_file_name(Some("main"), RenderArtifactKind::RenderedModel),
            "main-rendered_model.png"
        );
        assert_eq!(
            render_artifact_file_name(Some("main"), RenderArtifactKind::V1RenderedModel),
            "main-v1-rendered_model.png"
        );
        assert_eq!(
            render_artifact_file_name(Some("main"), RenderArtifactKind::V2RenderedModel),
            "main-v2-rendered_model.png"
        );
        assert_eq!(
            render_artifact_file_name(Some("main"), RenderArtifactKind::Diff),
            "main-diff.png"
        );
    }

    #[test]
    fn artifact_path_joins_output_directory_and_generated_name() {
        assert_eq!(
            render_artifact_path(
                Path::new("/tmp/output"),
                Some("main"),
                RenderArtifactKind::RenderedModel
            ),
            PathBuf::from("/tmp/output/main-rendered_model.png")
        );
    }
}
