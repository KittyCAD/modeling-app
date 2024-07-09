use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use anyhow::Result;
use kcl_lib::{
    errors::KclError, executor::DefaultPlanes,
};
use kittycad::types::{ModelingCmd, OkWebSocketResponseData, WebSocketRequest, WebSocketResponse, PathSegment::*};

#[derive(Debug, Clone)]
pub struct EngineConnection {
    batch: Arc<Mutex<Vec<(WebSocketRequest, kcl_lib::executor::SourceRange)>>>,
    batch_end: Arc<Mutex<HashMap<uuid::Uuid, (WebSocketRequest, kcl_lib::executor::SourceRange)>>>,
    core_test: Arc<Mutex<String>>,
}

impl EngineConnection {
    pub async fn new(result: Arc<Mutex<String>>) -> Result<EngineConnection> {
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
                        let cpp_id = id_to_cpp(&request.cmd_id);

                        let new_code: String = match &request.cmd {
                            ModelingCmd::StartPath { } => {
                                format!(r#"
                                    auto sketch_{} = make_shared<Object>("sketch", glm::vec3 {{ 0, 0, 0 }});
                                    sketch_{}->makePath(true);
                                    auto path_{} = sketch->get<Model::Brep::Path>();
                                "#, cpp_id, cpp_id, cpp_id)
                            },
                            ModelingCmd::MovePathPen { path, to } => {
                                format!(r#"
                                    path_{}->moveTo({{ {}, {}, 0.0 }});
                                "#, path, to.x, to.y)
                            },
                            ModelingCmd::ExtendPath { path, segment } => {
                                match segment {
                                    Line { end, relative } => {
                                        format!(r#"
                                            path_{}->lineTo({{ {}, {}, 0.0 }}, {{ {} }});
                                        "#, path, end.x, end.y, relative).into()
                                    },
                                    _ => {
                                        "".into()
                                    }
                                }

                            },
                            ModelingCmd::ClosePath { path_id } => {
                                format!(r#"
                                    path_{}->close();
                                "#, path_id).into()
                            },
                            ModelingCmd::Extrude { cap: _, distance, target } => {
                                format!(r#"
                                    sketch_{}->extrudeToSolid3D({}, true);
                                "#, target, distance).into()
                            },
                            _ => {
                                "".into()
                            },
                        };

                        //let new_code = format!("{:?}", request);
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
