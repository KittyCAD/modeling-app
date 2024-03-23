//! Functions for managing engine communications.

#[cfg(not(target_arch = "wasm32"))]
#[cfg(feature = "engine")]
pub mod conn;
pub mod conn_mock;
#[cfg(target_arch = "wasm32")]
#[cfg(feature = "engine")]
pub mod conn_wasm;

#[async_trait::async_trait]
pub trait EngineManager: std::fmt::Debug + Send + Sync + 'static {
    /// Send a modeling command and wait for the response message.
    async fn send_modeling_cmd(
        &self,
        flush_batch: bool,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError>;
}

pub fn is_cmd_with_return_values(cmd: &kittycad::types::ModelingCmd) -> bool {
    let (kittycad::types::ModelingCmd::Export { .. }
    | kittycad::types::ModelingCmd::Extrude { .. }
    | kittycad::types::ModelingCmd::SketchModeDisable { .. }
    | kittycad::types::ModelingCmd::ObjectBringToFront { .. }
    | kittycad::types::ModelingCmd::SelectWithPoint { .. }
    | kittycad::types::ModelingCmd::HighlightSetEntity { .. }
    | kittycad::types::ModelingCmd::EntityGetChildUuid { .. }
    | kittycad::types::ModelingCmd::EntityGetNumChildren { .. }
    | kittycad::types::ModelingCmd::EntityGetParentId { .. }
    | kittycad::types::ModelingCmd::EntityGetAllChildUuids { .. }
    | kittycad::types::ModelingCmd::CameraDragMove { .. }
    | kittycad::types::ModelingCmd::CameraDragEnd { .. }
    | kittycad::types::ModelingCmd::DefaultCameraGetSettings { .. }
    | kittycad::types::ModelingCmd::DefaultCameraZoom { .. }
    | kittycad::types::ModelingCmd::SelectGet { .. }
    | kittycad::types::ModelingCmd::Solid3DGetAllEdgeFaces { .. }
    | kittycad::types::ModelingCmd::Solid3DGetAllOppositeEdges { .. }
    | kittycad::types::ModelingCmd::Solid3DGetOppositeEdge { .. }
    | kittycad::types::ModelingCmd::Solid3DGetNextAdjacentEdge { .. }
    | kittycad::types::ModelingCmd::Solid3DGetPrevAdjacentEdge { .. }
    | kittycad::types::ModelingCmd::GetEntityType { .. }
    | kittycad::types::ModelingCmd::CurveGetControlPoints { .. }
    | kittycad::types::ModelingCmd::CurveGetType { .. }
    | kittycad::types::ModelingCmd::MouseClick { .. }
    | kittycad::types::ModelingCmd::TakeSnapshot { .. }
    | kittycad::types::ModelingCmd::PathGetInfo { .. }
    | kittycad::types::ModelingCmd::PathGetCurveUuidsForVertices { .. }
    | kittycad::types::ModelingCmd::PathGetVertexUuids { .. }
    | kittycad::types::ModelingCmd::CurveGetEndPoints { .. }
    | kittycad::types::ModelingCmd::FaceIsPlanar { .. }
    | kittycad::types::ModelingCmd::FaceGetPosition { .. }
    | kittycad::types::ModelingCmd::FaceGetGradient { .. }
    | kittycad::types::ModelingCmd::PlaneIntersectAndProject { .. }
    | kittycad::types::ModelingCmd::ImportFiles { .. }
    | kittycad::types::ModelingCmd::Mass { .. }
    | kittycad::types::ModelingCmd::Volume { .. }
    | kittycad::types::ModelingCmd::Density { .. }
    | kittycad::types::ModelingCmd::SurfaceArea { .. }
    | kittycad::types::ModelingCmd::CenterOfMass { .. }
    | kittycad::types::ModelingCmd::GetSketchModePlane { .. }
    | kittycad::types::ModelingCmd::EntityGetDistance { .. }
    | kittycad::types::ModelingCmd::EntityLinearPattern { .. }
    | kittycad::types::ModelingCmd::EntityCircularPattern { .. }
    | kittycad::types::ModelingCmd::Solid3DGetExtrusionFaceInfo { .. }) = cmd
    else {
        return false;
    };

    true
}
