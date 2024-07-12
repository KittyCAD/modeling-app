use anyhow::Result;
use kcl_lib::{errors::KclError, executor::DefaultPlanes};
use kittycad::types::{ModelingCmd, OkWebSocketResponseData, PathSegment::*, WebSocketRequest, WebSocketResponse};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

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
            code.push_str(CPP_PREFIX);
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

fn generate_repl_uuids(count: usize) -> Vec<uuid::Uuid> {
    let mut repl_ids: Vec<uuid::Uuid> = Vec::new();

    repl_ids.resize_with(count, uuid::Uuid::new_v4);
    repl_ids
}

#[allow(clippy::needless_range_loop)]
fn codegen_cpp_repl_uuid_setters(entity_ids: &[uuid::Uuid]) -> String {
    let mut codegen = String::new();

    for i in 0..entity_ids.len() {
        let id = entity_ids[i];
        let cpp_id = id_to_cpp(&entity_ids[i]);
        let iter = format!(
            r#"
            //change object id -> {id}
            auto repl_{cpp_id} = scene->getSceneObject(reps[{i}]);
            scene->removeSceneObject(repl_{cpp_id}->getUUID(), false);
            repl_{cpp_id}->setUUID(Utils::UUID("{id}"));
            scene->addSceneObject(repl_{cpp_id});
        "#
        );
        codegen.push_str(&iter);
    }

    codegen
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
                    let mut this_response = kittycad::types::OkModelingCmdResponse::Empty {};

                    if let Ok(mut test_code) = self.core_test.lock() {
                        let cmd_id = format!("{}", request.cmd_id);
                        let cpp_id = id_to_cpp(&request.cmd_id);

                        let new_code: String = match &request.cmd {
                            ModelingCmd::ObjectVisible { hidden, object_id } => {
                                format!(r#"scene->getSceneObject(Utils::UUID("{object_id}"))->setHidden({hidden});"#)
                            }
                            ModelingCmd::EnableSketchMode {
                                entity_id,
                                animated: _,
                                ortho: _,
                                adjust_camera: _,
                                planar_normal,
                            } => {
                                if let Some(normal) = planar_normal {
                                    format!(
                                        r#"
                                        if(!scene->enableSketchMode(Utils::UUID("{entity_id}"), glm::dvec3 {{ {}, {}, {}, }}, nullopt))
                                        {{
                                            Utils::Plane plane_{cpp_id}(glm::dvec3 {{ 0, 0, 0 }}, glm::dvec3 {{ 1, 0, 0 }}, glm::dvec3 {{ 0, 1, 0 }});
                                            scene->enableSketchMode(plane_{cpp_id}, nullopt, nullopt, false);
                                        }}
                                    "#,
                                        normal.x, normal.y, normal.z
                                    )
                                } else {
                                    "".into()
                                }
                            }
                            ModelingCmd::SketchModeDisable {} => "scene->disableSketchMode();".into(),
                            ModelingCmd::MakePlane {
                                origin,
                                x_axis,
                                y_axis,
                                size,
                                ..
                            } => {
                                let plane_id = format!("plane_{}", cpp_id);
                                format!(
                                    r#"
                                    auto {plane_id} = make_shared<Object>("plane", glm::dvec3 {{ 0, 0, 0 }});
                                    {plane_id}->setUUID(Utils::UUID("{cmd_id}"));
                                    {plane_id}->makePlane(glm::dvec3 {{ {}, {}, {} }} * scaleFactor, glm::dvec3 {{ {}, {}, {} }}, glm::dvec3 {{ {}, {}, {} }}, {}, false);
                                    {plane_id}->setHidden();
                                    scene->addSceneObject({plane_id});
                                "#,
                                    origin.x,
                                    origin.y,
                                    origin.z,
                                    x_axis.x,
                                    x_axis.y,
                                    x_axis.z,
                                    y_axis.x,
                                    y_axis.y,
                                    y_axis.z,
                                    size
                                )
                            }
                            ModelingCmd::StartPath {} => {
                                let sketch_id = format!("sketch_{}", cpp_id);
                                let path_id = format!("path_{}", cpp_id);
                                format!(
                                    r#"
                                    auto {sketch_id} = make_shared<Object>("sketch", glm::dvec3 {{ 0, 0, 0 }});
                                    {sketch_id}->setUUID(Utils::UUID("{cmd_id}"));
                                    {sketch_id}->makePath(true);
                                    auto {path_id} = {sketch_id}->get<Model::Brep::Path>();
                                    scene->addSceneObject({sketch_id});
                                "#
                                )
                            }
                            ModelingCmd::MovePathPen { path, to } => {
                                format!(
                                    r#"
                                    path_{}->moveTo(glm::dvec3 {{ {}, {}, 0.0 }} * scaleFactor);
                                "#,
                                    id_to_cpp(path),
                                    to.x,
                                    to.y
                                )
                            }
                            ModelingCmd::ExtendPath { path, segment } => match segment {
                                Line { end, relative } => {
                                    format!(
                                        r#"
                                            path_{}->lineTo(glm::dvec3 {{ {}, {}, 0.0 }} * scaleFactor, {{ {} }});
                                        "#,
                                        id_to_cpp(path),
                                        end.x,
                                        end.y,
                                        relative
                                    )
                                }
                                kittycad::types::PathSegment::Arc {
                                    center,
                                    radius,
                                    start,
                                    end,
                                    relative,
                                } => {
                                    let start = start.value;
                                    let end = end.value;

                                    format!(
                                        r#"
                                            path_{}->addArc(glm::dvec2 {{ {}, {} }} * scaleFactor, {radius} * scaleFactor, {start}, {end}, {{ {} }});
                                        "#,
                                        id_to_cpp(path),
                                        center.x,
                                        center.y,
                                        relative
                                    )
                                }
                                _ => {
                                    format!("//{:?}", request.cmd)
                                }
                            },
                            ModelingCmd::ClosePath { path_id } => {
                                format!(
                                    r#"
                                    path_{}->close();
                                    sketch_{}->toSolid2D();
                                "#,
                                    id_to_cpp(path_id),
                                    id_to_cpp(path_id)
                                )
                            }
                            ModelingCmd::Extrude {
                                cap: _,
                                distance,
                                target,
                            } => {
                                format!(
                                    r#"
                                    sketch_{}->extrudeToSolid3D({} * scaleFactor, true);
                                "#,
                                    id_to_cpp(target),
                                    distance
                                )
                            }
                            ModelingCmd::Solid2DAddHole { hole_id, object_id } => {
                                format!(
                                    r#"scene->getSceneObject(Utils::UUID("{object_id}"))->get<Model::Brep::Solid2D>()->addHole(
                                    make_shared<Model::Brep::Path>(*scene->getSceneObject(Utils::UUID("{hole_id}"))->get<Model::Brep::Solid2D>()->getPath())
                                );"#
                                )
                            }
                            ModelingCmd::Solid3DGetExtrusionFaceInfo { object_id, edge_id } => {
                                format!(
                                    r#"
                                    //face info get {} {}
                                "#,
                                    object_id, edge_id
                                )
                            }
                            ModelingCmd::EntityCircularPattern {
                                entity_id,
                                axis,
                                center,
                                num_repetitions,
                                arc_degrees,
                                rotate_duplicates,
                            } => {
                                let entity_ids = generate_repl_uuids(*num_repetitions as usize);

                                this_response = kittycad::types::OkModelingCmdResponse::EntityCircularPattern {
                                    data: kittycad::types::EntityCircularPattern {
                                        entity_ids: entity_ids.clone(),
                                    },
                                };

                                let mut base_code: String = format!(
                                    r#"
                                    auto reps = scene->entityCircularPattern(Utils::UUID("{}"), {num_repetitions}, glm::dvec3 {{ {}, {}, {} }}  * scaleFactor, glm::dvec3 {{ {}, {}, {} }}  * scaleFactor, {arc_degrees}, {rotate_duplicates});
                                "#,
                                    entity_id, axis.x, axis.y, axis.z, center.x, center.y, center.z
                                );

                                let repl_uuid_fix_code = codegen_cpp_repl_uuid_setters(&entity_ids);
                                base_code.push_str(&repl_uuid_fix_code);

                                base_code
                            }
                            _ => {
                                //helps us follow along with the currently unhandled engine commands
                                format!("//{:?}", request.cmd)
                            }
                        };

                        if !new_code.is_empty() {
                            let new_code = new_code
                                .trim()
                                .split(' ')
                                .filter(|s| !s.is_empty())
                                .collect::<Vec<_>>()
                                .join(" ")
                                + "\n";
                            test_code.push_str(&new_code);
                        }
                    }

                    responses.insert(
                        request.cmd_id.to_string(),
                        kittycad::types::BatchResponse {
                            response: Some(this_response),
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
