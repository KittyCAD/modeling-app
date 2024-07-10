use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use anyhow::Result;
use kcl_lib::{
    errors::KclError, executor::DefaultPlanes,
};
use kittycad::types::{ModelingCmd, OkWebSocketResponseData, WebSocketRequest, WebSocketResponse, PathSegment::*};

const CPP_PREFIX: &str = "const double scaleFactor = 100;\n";

#[derive(Debug, Clone)]
pub struct EngineConnection {
    batch: Arc<Mutex<Vec<(WebSocketRequest, kcl_lib::executor::SourceRange)>>>,
    batch_end: Arc<Mutex<HashMap<uuid::Uuid, (WebSocketRequest, kcl_lib::executor::SourceRange)>>>,
    core_test: Arc<Mutex<String>>,
}

impl EngineConnection {
    pub async fn new(result: Arc<Mutex<String>>) -> Result<EngineConnection> {
        if let Ok(mut code) = result.lock() {
            code.push_str(&CPP_PREFIX);
        }

        Ok(EngineConnection {
            batch: Arc::new(Mutex::new(Vec::new())),
            batch_end: Arc::new(Mutex::new(HashMap::new())),
            core_test: result,
        })
    }
}

fn id_to_cpp(id: &uuid::Uuid) -> String {
    let str = format!("{}", id);
    str::replace(&str, "-", "_")
}

#[async_trait::async_trait]
impl kcl_lib::engine::EngineManager for EngineConnection {
    fn batch(&self) -> Arc<Mutex<Vec<(WebSocketRequest, kcl_lib::executor::SourceRange)>>> {
        self.batch.clone()
    }

    fn batch_end(&self) -> Arc<Mutex<HashMap<uuid::Uuid, (WebSocketRequest, kcl_lib::executor::SourceRange)>>> {
        self.batch_end.clone()
    }

    async fn default_planes(&self, _source_range: kcl_lib::executor::SourceRange) -> Result<DefaultPlanes, KclError> {
        Ok(DefaultPlanes::default())
    }

    async fn clear_scene_post_hook(&self, _source_range: kcl_lib::executor::SourceRange) -> Result<(), KclError> {
        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        _source_range: kcl_lib::executor::SourceRange,
        cmd: kittycad::types::WebSocketRequest,
        _id_to_source_range: std::collections::HashMap<uuid::Uuid, kcl_lib::executor::SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        match cmd {
            WebSocketRequest::ModelingCmdBatchReq {
                ref requests,
                batch_id: _,
                responses: _,
            } => {
                let mut responses = HashMap::new();
                for request in requests {
                    if let Ok(mut test_code) = self.core_test.lock() {
                        let cmd_id = format!("{}", request.cmd_id);
                        let cpp_id = id_to_cpp(&request.cmd_id);

                        let new_code: String = match &request.cmd {
                            ModelingCmd::EnableSketchMode { entity_id, animated: _, ortho: _, adjust_camera: _, planar_normal } => {
                                if let Some(normal) = planar_normal {
                                    format!(r#"
                                        if(!scene->enableSketchMode(Utils::UUID("{entity_id}"), glm::dvec3 {{ {}, {}, {}, }}, nullopt))
                                        {{
                                            Utils::Plane plane_{cpp_id}(glm::dvec3 {{ 0, 0, 0 }}, glm::dvec3 {{ 1, 0, 0 }}, glm::dvec3 {{ 0, 1, 0 }});
                                            scene->enableSketchMode(plane_{cpp_id}, nullopt, nullopt, false);
                                        }}
                                    "#, normal.x, normal.y, normal.z)
                                } else {
                                    "".into()
                                }
                            },
                            ModelingCmd::SketchModeDisable { } => {
                                "scene->disableSketchMode();".into()
                            },
                            ModelingCmd::MakePlane { origin, x_axis, y_axis, size, .. } => {
                                let plane_id = format!("plane_{}", cpp_id);
                                format!(r#"
                                    auto {plane_id} = make_shared<Object>("plane", glm::dvec3 {{ 0, 0, 0 }});
                                    {plane_id}->setUUID(Utils::UUID("{cmd_id}"));
                                    {plane_id}->makePlane(glm::dvec3 {{ {}, {}, {} }} * scaleFactor, glm::dvec3 {{ {}, {}, {} }}, glm::dvec3 {{ {}, {}, {} }}, {}, false);
                                    {plane_id}->setHidden();
                                    scene->addSceneObject({plane_id});
                                "#, origin.x, origin.y, origin.z,
                                    x_axis.x, x_axis.y, x_axis.z,
                                    y_axis.x, y_axis.y, y_axis.z,
                                    size)
                            },
                            ModelingCmd::StartPath { } => {
                                let sketch_id = format!("sketch_{}", cpp_id);
                                let path_id = format!("path_{}", cpp_id);
                                format!(r#"
                                    auto {sketch_id} = make_shared<Object>("sketch", glm::dvec3 {{ 0, 0, 0 }});
                                    {sketch_id}->setUUID(Utils::UUID("{cmd_id}"));
                                    {sketch_id}->makePath(true);
                                    auto {path_id} = {sketch_id}->get<Model::Brep::Path>();
                                    scene->addSceneObject({sketch_id});
                                "#)
                            },
                            ModelingCmd::MovePathPen { path, to } => {
                                format!(r#"
                                    path_{}->moveTo({{ {}, {}, 0.0 }});
                                "#, id_to_cpp(&path), to.x, to.y)
                            },
                            ModelingCmd::ExtendPath { path, segment } => {
                                match segment {
                                    Line { end, relative } => {
                                        format!(r#"
                                            path_{}->lineTo(glm::dvec3 {{ {}, {}, 0.0 }} * scaleFactor, {{ {} }});
                                        "#, id_to_cpp(&path), end.x, end.y, relative).into()
                                    },
                                    kittycad::types::PathSegment::Arc { center, radius, start, end, relative } => {                                        
                                        let start = start.value;
                                        let end = end.value;

                                        format!(r#"
                                            path_{}->addArc(glm::dvec2 {{ {}, {} }} * scaleFactor, {radius} * scaleFactor, {start}, {end}, {{ {} }});
                                        "#, id_to_cpp(&path), center.x, center.y, relative).into()
                                    },
                                    _ => {
                                        format!("//{:?}", request.cmd).into()
                                    }
                                }
                            },
                            ModelingCmd::ClosePath { path_id } => {
                                format!(r#"
                                    path_{}->close();
                                "#, id_to_cpp(&path_id)).into()
                            },
                            ModelingCmd::Extrude { cap: _, distance, target } => {
                                format!(r#"
                                    sketch_{}->extrudeToSolid3D({} * scaleFactor, true);
                                "#, id_to_cpp(&target), distance).into()
                            },
                            ModelingCmd::Solid3DGetExtrusionFaceInfo { object_id, edge_id } => {
                                format!(r#"
                                    //face info get {} {}
                                "#, object_id, edge_id).into()
                            },
                            ModelingCmd::EntityCircularPattern { .. } => {
                                format!(r#"
                                    //pattern!!
                                "#).into()
                            },
                            _ => {
                                //helps us follow along with the currently unhandled engine commands
                                format!("//{:?}", request.cmd).into()
                            },
                        };

                        if new_code.len() > 0 {
                            let new_code = new_code.trim().split(' ').filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ") + "\n";
                            test_code.push_str(&new_code);
                        }
                    }

                    responses.insert(
                        request.cmd_id.to_string(),
                        kittycad::types::BatchResponse {
                            response: Some(kittycad::types::OkModelingCmdResponse::Empty {}),
                            errors: None,
                        },
                    );
                }
                Ok(WebSocketResponse {
                    request_id: Some(id),
                    resp: Some(OkWebSocketResponseData::ModelingBatch { responses }),
                    success: Some(true),
                    errors: None,
                })
            }
            _ => Ok(WebSocketResponse {
                request_id: Some(id),
                resp: Some(OkWebSocketResponseData::Modeling {
                    modeling_response: kittycad::types::OkModelingCmdResponse::Empty {},
                }),
                success: Some(true),
                errors: None,
            }),
        }
    }
}
