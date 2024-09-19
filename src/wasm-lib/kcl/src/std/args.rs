use std::any::type_name;

use anyhow::Result;
use kcmc::websocket::OkWebSocketResponseData;
use kcmc::ModelingCmd;
use kittycad_modeling_cmds as kcmc;
use serde::de::DeserializeOwned;

use crate::{
    ast::types::{parse_json_number_as_f64, TagDeclarator},
    errors::{KclError, KclErrorDetails},
    executor::{
        ExecState, ExecutorContext, ExtrudeGroup, ExtrudeGroupSet, ExtrudeSurface, KclValue, Metadata, SketchGroup,
        SketchGroupSet, SketchSurface, SourceRange, TagIdentifier,
    },
    std::{shapes::SketchSurfaceOrGroup, sketch::FaceTag, FnAsArg},
};

#[derive(Debug, Clone)]
pub struct Args {
    pub args: Vec<KclValue>,
    pub source_range: SourceRange,
    pub ctx: ExecutorContext,
}

impl Args {
    pub fn new(args: Vec<KclValue>, source_range: SourceRange, ctx: ExecutorContext) -> Self {
        Self {
            args,
            source_range,
            ctx,
        }
    }

    #[cfg(test)]
    pub(crate) async fn new_test_args() -> Result<Self> {
        use std::sync::Arc;

        Ok(Self {
            args: Vec::new(),
            source_range: SourceRange::default(),
            ctx: ExecutorContext {
                engine: Arc::new(Box::new(crate::engine::conn_mock::EngineConnection::new().await?)),
                fs: Arc::new(crate::fs::FileManager::new()),
                stdlib: Arc::new(crate::std::StdLib::new()),
                settings: Default::default(),
                is_mock: true,
            },
        })
    }

    // Add a modeling command to the batch but don't fire it right away.
    pub(crate) async fn batch_modeling_cmd(
        &self,
        id: uuid::Uuid,
        cmd: ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        self.ctx.engine.batch_modeling_cmd(id, self.source_range, &cmd).await
    }

    // Add a modeling command to the batch that gets executed at the end of the file.
    // This is good for something like fillet or chamfer where the engine would
    // eat the path id if we executed it right away.
    pub(crate) async fn batch_end_cmd(&self, id: uuid::Uuid, cmd: ModelingCmd) -> Result<(), crate::errors::KclError> {
        self.ctx.engine.batch_end_cmd(id, self.source_range, &cmd).await
    }

    /// Send the modeling cmd and wait for the response.
    pub(crate) async fn send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        cmd: ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        self.ctx.engine.send_modeling_cmd(id, self.source_range, cmd).await
    }

    fn get_tag_info_from_memory<'a, 'e>(
        &'a self,
        exec_state: &'e mut ExecState,
        tag: &'a TagIdentifier,
    ) -> Result<&'e crate::executor::TagEngineInfo, KclError> {
        if let KclValue::TagIdentifier(t) = exec_state.memory.get(&tag.value, self.source_range)? {
            Ok(t.info.as_ref().ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: format!("Tag `{}` does not have engine info", tag.value),
                    source_ranges: vec![self.source_range],
                })
            })?)
        } else {
            Err(KclError::Type(KclErrorDetails {
                message: format!("Tag `{}` does not exist", tag.value),
                source_ranges: vec![self.source_range],
            }))
        }
    }

    pub(crate) fn get_tag_engine_info<'a, 'e>(
        &'a self,
        exec_state: &'e mut ExecState,
        tag: &'a TagIdentifier,
    ) -> Result<&'a crate::executor::TagEngineInfo, KclError>
    where
        'e: 'a,
    {
        if let Some(info) = &tag.info {
            return Ok(info);
        }

        self.get_tag_info_from_memory(exec_state, tag)
    }

    fn get_tag_engine_info_check_surface<'a, 'e>(
        &'a self,
        exec_state: &'e mut ExecState,
        tag: &'a TagIdentifier,
    ) -> Result<&'a crate::executor::TagEngineInfo, KclError>
    where
        'e: 'a,
    {
        if let Some(info) = &tag.info {
            if info.surface.is_some() {
                return Ok(info);
            }
        }

        self.get_tag_info_from_memory(exec_state, tag)
    }

    /// Flush just the fillets and chamfers for this specific ExtrudeGroupSet.
    #[allow(clippy::vec_box)]
    pub(crate) async fn flush_batch_for_extrude_group_set(
        &self,
        exec_state: &mut ExecState,
        extrude_groups: Vec<Box<ExtrudeGroup>>,
    ) -> Result<(), KclError> {
        // Make sure we don't traverse sketch_groups more than once.
        let mut traversed_sketch_groups = Vec::new();

        // Collect all the fillet/chamfer ids for the extrude groups.
        let mut ids = Vec::new();
        for extrude_group in extrude_groups {
            // We need to traverse the extrude groups that share the same sketch group.
            let sketch_group_id = extrude_group.sketch_group.id;
            if !traversed_sketch_groups.contains(&sketch_group_id) {
                // Find all the extrude groups on the same shared sketch group.
                ids.extend(
                    exec_state
                        .memory
                        .find_extrude_groups_on_sketch_group(extrude_group.sketch_group.id)
                        .iter()
                        .flat_map(|eg| eg.get_all_edge_cut_ids()),
                );
                ids.extend(exec_state.dynamic_state.edge_cut_ids_on_sketch_group(sketch_group_id));
                traversed_sketch_groups.push(sketch_group_id);
            }

            ids.extend(extrude_group.get_all_edge_cut_ids());
        }

        // We can return early if there are no fillets or chamfers.
        if ids.is_empty() {
            return Ok(());
        }

        // We want to move these fillets and chamfers from batch_end to batch so they get executed
        // before what ever we call next.
        for id in ids {
            // Pop it off the batch_end and add it to the batch.
            let Some(item) = self.ctx.engine.batch_end().lock().unwrap().remove(&id) else {
                // It might be in the batch already.
                continue;
            };
            // Add it to the batch.
            self.ctx.engine.batch().lock().unwrap().push(item);
        }

        // Run flush.
        // Yes, we do need to actually flush the batch here, or references will fail later.
        self.ctx.engine.flush_batch(false, SourceRange::default()).await?;

        Ok(())
    }

    fn make_user_val_from_json(&self, j: serde_json::Value) -> Result<KclValue, KclError> {
        Ok(KclValue::UserVal(crate::executor::UserVal {
            value: j,
            meta: vec![Metadata {
                source_range: self.source_range,
            }],
        }))
    }

    pub(crate) fn make_null_user_val(&self) -> Result<KclValue, KclError> {
        self.make_user_val_from_json(serde_json::Value::Null)
    }

    pub(crate) fn make_user_val_from_i64(&self, n: i64) -> Result<KclValue, KclError> {
        self.make_user_val_from_json(serde_json::Value::Number(serde_json::Number::from(n)))
    }

    pub(crate) fn make_user_val_from_f64(&self, f: f64) -> Result<KclValue, KclError> {
        self.make_user_val_from_json(serde_json::Value::Number(serde_json::Number::from_f64(f).ok_or_else(
            || {
                KclError::Type(KclErrorDetails {
                    message: format!("Failed to convert `{}` to a number", f),
                    source_ranges: vec![self.source_range],
                })
            },
        )?))
    }

    pub(crate) fn make_user_val_from_f64_array(&self, f: Vec<f64>) -> Result<KclValue, KclError> {
        let mut arr = Vec::new();
        for n in f {
            arr.push(serde_json::Value::Number(serde_json::Number::from_f64(n).ok_or_else(
                || {
                    KclError::Type(KclErrorDetails {
                        message: format!("Failed to convert `{}` to a number", n),
                        source_ranges: vec![self.source_range],
                    })
                },
            )?));
        }
        self.make_user_val_from_json(serde_json::Value::Array(arr))
    }

    pub(crate) fn get_number(&self) -> Result<f64, KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_number_array(&self) -> Result<Vec<f64>, KclError> {
        let mut numbers: Vec<f64> = Vec::new();
        for arg in &self.args {
            let parsed = arg.get_json_value()?;
            numbers.push(parse_json_number_as_f64(&parsed, self.source_range)?);
        }
        Ok(numbers)
    }

    pub(crate) fn get_pattern_transform_args(&self) -> Result<(u32, FnAsArg<'_>, ExtrudeGroupSet), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_hypotenuse_leg(&self) -> Result<(f64, f64), KclError> {
        let numbers = self.get_number_array()?;

        if numbers.len() != 2 {
            return Err(KclError::Type(KclErrorDetails {
                message: format!("Expected a number array of length 2, found `{:?}`", numbers),
                source_ranges: vec![self.source_range],
            }));
        }

        Ok((numbers[0], numbers[1]))
    }

    pub(crate) fn get_circle_args(
        &self,
    ) -> Result<
        (
            [f64; 2],
            f64,
            crate::std::shapes::SketchSurfaceOrGroup,
            Option<TagDeclarator>,
        ),
        KclError,
    > {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_sketch_groups(&self) -> Result<(SketchGroupSet, SketchGroup), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_sketch_group(&self) -> Result<SketchGroup, KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data<'a, T>(&'a self) -> Result<T, KclError>
    where
        T: FromArgs<'a> + serde::de::DeserializeOwned,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_import_data(&self) -> Result<(String, Option<crate::std::import::ImportFormat>), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_sketch_group_and_optional_tag(&self) -> Result<(SketchGroup, Option<TagDeclarator>), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_sketch_groups_and_data<'a, T>(&'a self) -> Result<(Vec<SketchGroup>, Option<T>), KclError>
    where
        T: FromArgs<'a> + serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_optional_tag<'a, T>(&'a self) -> Result<(T, Option<FaceTag>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch_group<'a, T>(&'a self) -> Result<(T, SketchGroup), KclError>
    where
        T: serde::de::DeserializeOwned + FromArgs<'a>,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch_group_set<'a, T>(&'a self) -> Result<(T, SketchGroupSet), KclError>
    where
        T: serde::de::DeserializeOwned + FromArgs<'a>,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch_group_and_tag<'a, T>(
        &'a self,
    ) -> Result<(T, SketchGroup, Option<TagDeclarator>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch_surface<'a, T>(
        &'a self,
    ) -> Result<(T, SketchSurface, Option<TagDeclarator>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_extrude_group_set<'a, T>(&'a self) -> Result<(T, ExtrudeGroupSet), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_extrude_group<'a, T>(&'a self) -> Result<(T, Box<ExtrudeGroup>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_extrude_group_and_tag<'a, T>(
        &'a self,
    ) -> Result<(T, Box<ExtrudeGroup>, Option<TagDeclarator>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_tag_to_number_sketch_group(&self) -> Result<(TagIdentifier, f64, SketchGroup), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_float<'a, T>(&'a self) -> Result<(T, f64), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_number_sketch_group_set(&self) -> Result<(f64, SketchGroupSet), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) async fn get_adjacent_face_to_tag(
        &self,
        exec_state: &mut ExecState,
        tag: &TagIdentifier,
        must_be_planar: bool,
    ) -> Result<uuid::Uuid, KclError> {
        if tag.value.is_empty() {
            return Err(KclError::Type(KclErrorDetails {
                message: "Expected a non-empty tag for the face".to_string(),
                source_ranges: vec![self.source_range],
            }));
        }

        let engine_info = self.get_tag_engine_info_check_surface(exec_state, tag)?;

        let surface = engine_info.surface.as_ref().ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Tag `{}` does not have a surface", tag.value),
                source_ranges: vec![self.source_range],
            })
        })?;

        if let Some(face_from_surface) = match surface {
            ExtrudeSurface::ExtrudePlane(extrude_plane) => {
                if let Some(plane_tag) = &extrude_plane.tag {
                    if plane_tag.name == tag.value {
                        Some(Ok(extrude_plane.face_id))
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            // The must be planar check must be called before the arc check.
            ExtrudeSurface::ExtrudeArc(_) if must_be_planar => Some(Err(KclError::Type(KclErrorDetails {
                message: format!("Tag `{}` is a non-planar surface", tag.value),
                source_ranges: vec![self.source_range],
            }))),
            ExtrudeSurface::ExtrudeArc(extrude_arc) => {
                if let Some(arc_tag) = &extrude_arc.tag {
                    if arc_tag.name == tag.value {
                        Some(Ok(extrude_arc.face_id))
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            ExtrudeSurface::Chamfer(chamfer) => {
                if let Some(chamfer_tag) = &chamfer.tag {
                    if chamfer_tag.name == tag.value {
                        Some(Ok(chamfer.face_id))
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            // The must be planar check must be called before the fillet check.
            ExtrudeSurface::Fillet(_) if must_be_planar => Some(Err(KclError::Type(KclErrorDetails {
                message: format!("Tag `{}` is a non-planar surface", tag.value),
                source_ranges: vec![self.source_range],
            }))),
            ExtrudeSurface::Fillet(fillet) => {
                if let Some(fillet_tag) = &fillet.tag {
                    if fillet_tag.name == tag.value {
                        Some(Ok(fillet.face_id))
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
        } {
            return face_from_surface;
        }

        // If we still haven't found the face, return an error.
        Err(KclError::Type(KclErrorDetails {
            message: format!("Expected a face with the tag `{}`", tag.value),
            source_ranges: vec![self.source_range],
        }))
    }
}

/// Types which impl this trait can be read out of the `Args` passed into a KCL function.
pub trait FromArgs<'a>: Sized {
    /// Get this type from the args passed into a KCL function, at the given index in the argument list.
    fn from_args(args: &'a Args, index: usize) -> Result<Self, KclError>;
}

/// Types which impl this trait can be extracted from a `KclValue`.
pub trait FromKclValue<'a>: Sized {
    /// Try to convert a KclValue into this type.
    fn from_mem_item(arg: &'a KclValue) -> Option<Self>;
}

impl<'a, T> FromArgs<'a> for T
where
    T: FromKclValue<'a> + Sized,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let Some(arg) = args.args.get(i) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected an argument at index {i}"),
                source_ranges: vec![args.source_range],
            }));
        };
        let Some(val) = T::from_mem_item(arg) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Argument at index {i} was supposed to be type {} but found {}",
                    type_name::<T>(),
                    arg.human_friendly_type()
                ),
                source_ranges: vec![args.source_range],
            }));
        };
        Ok(val)
    }
}

impl<'a> FromArgs<'a> for KclValue {
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let Some(v) = args.args.get(i) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Argument at index {i} was missing",),
                source_ranges: vec![args.source_range],
            }));
        };
        Ok(v.to_owned())
    }
}

impl<'a, T> FromArgs<'a> for Option<T>
where
    T: FromKclValue<'a> + Sized,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let Some(arg) = args.args.get(i) else { return Ok(None) };
        if crate::ast::types::KclNone::from_mem_item(arg).is_some() {
            return Ok(None);
        }
        let Some(val) = T::from_mem_item(arg) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Argument at index {i} was supposed to be type {} but found {}",
                    type_name::<T>(),
                    arg.human_friendly_type()
                ),
                source_ranges: vec![args.source_range],
            }));
        };
        Ok(Some(val))
    }
}

impl<'a, A, B> FromArgs<'a> for (A, B)
where
    A: FromArgs<'a>,
    B: FromArgs<'a>,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let a = A::from_args(args, i)?;
        let b = B::from_args(args, i + 1)?;
        Ok((a, b))
    }
}

impl<'a, A, B, C> FromArgs<'a> for (A, B, C)
where
    A: FromArgs<'a>,
    B: FromArgs<'a>,
    C: FromArgs<'a>,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let a = A::from_args(args, i)?;
        let b = B::from_args(args, i + 1)?;
        let c = C::from_args(args, i + 2)?;
        Ok((a, b, c))
    }
}
impl<'a, A, B, C, D> FromArgs<'a> for (A, B, C, D)
where
    A: FromArgs<'a>,
    B: FromArgs<'a>,
    C: FromArgs<'a>,
    D: FromArgs<'a>,
{
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let a = A::from_args(args, i)?;
        let b = B::from_args(args, i + 1)?;
        let c = C::from_args(args, i + 2)?;
        let d = D::from_args(args, i + 3)?;
        Ok((a, b, c, d))
    }
}

impl<'a> FromKclValue<'a> for &'a str {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        arg.as_user_val().and_then(|uv| uv.value.as_str())
    }
}

impl<'a> FromKclValue<'a> for TagDeclarator {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        arg.get_tag_declarator().ok()
    }
}

impl<'a> FromKclValue<'a> for TagIdentifier {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        arg.get_tag_identifier().ok()
    }
}

macro_rules! impl_from_arg_via_json {
    ($typ:path) => {
        impl<'a> FromKclValue<'a> for $typ {
            fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
                from_user_val(arg)
            }
        }
    };
}

macro_rules! impl_from_arg_for_array {
    ($n:literal) => {
        impl<'a, T> FromKclValue<'a> for [T; $n]
        where
            T: serde::de::DeserializeOwned + FromKclValue<'a>,
        {
            fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
                from_user_val(arg)
            }
        }
    };
}

fn from_user_val<T: DeserializeOwned>(arg: &KclValue) -> Option<T> {
    let v = match arg {
        KclValue::UserVal(v) => v.value.clone(),
        other => serde_json::to_value(other).ok()?,
    };
    serde_json::from_value(v).ok()
}

impl_from_arg_via_json!(super::sketch::AngledLineData);
impl_from_arg_via_json!(super::sketch::AngledLineToData);
impl_from_arg_via_json!(super::sketch::AngledLineThatIntersectsData);
impl_from_arg_via_json!(super::sketch::ArcData);
impl_from_arg_via_json!(super::sketch::TangentialArcData);
impl_from_arg_via_json!(super::sketch::BezierData);
impl_from_arg_via_json!(super::chamfer::ChamferData);
impl_from_arg_via_json!(super::patterns::LinearPattern3dData);
impl_from_arg_via_json!(super::patterns::CircularPattern3dData);
impl_from_arg_via_json!(super::patterns::LinearPattern2dData);
impl_from_arg_via_json!(super::patterns::CircularPattern2dData);
impl_from_arg_via_json!(super::helix::HelixData);
impl_from_arg_via_json!(super::shell::ShellData);
impl_from_arg_via_json!(super::fillet::FilletData);
impl_from_arg_via_json!(super::revolve::RevolveData);
impl_from_arg_via_json!(super::sketch::SketchData);
impl_from_arg_via_json!(crate::std::import::ImportFormat);
impl_from_arg_via_json!(crate::std::polar::PolarCoordsData);
impl_from_arg_via_json!(crate::std::loft::LoftData);
impl_from_arg_via_json!(crate::std::planes::StandardPlane);
impl_from_arg_via_json!(SketchGroup);
impl_from_arg_via_json!(FaceTag);
impl_from_arg_via_json!(String);
impl_from_arg_via_json!(crate::ast::types::KclNone);
impl_from_arg_via_json!(u32);
impl_from_arg_via_json!(u64);
impl_from_arg_via_json!(f64);
impl_from_arg_via_json!(bool);

impl_from_arg_for_array!(2);
impl_from_arg_for_array!(3);

impl<'a> FromKclValue<'a> for SketchGroupSet {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::UserVal(uv) = arg else {
            return None;
        };
        if let Some((x, _meta)) = uv.get::<SketchGroup>() {
            Some(SketchGroupSet::from(x))
        } else {
            uv.get::<Vec<SketchGroup>>().map(|x| x.0).map(SketchGroupSet::from)
        }
    }
}

impl<'a> FromKclValue<'a> for Box<ExtrudeGroup> {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::ExtrudeGroup(s) = arg else {
            return None;
        };
        Some(s.to_owned())
    }
}

impl<'a> FromKclValue<'a> for FnAsArg<'a> {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        arg.get_function()
    }
}

impl<'a> FromKclValue<'a> for ExtrudeGroupSet {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        arg.get_extrude_group_set().ok()
    }
}
impl<'a> FromKclValue<'a> for SketchSurfaceOrGroup {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::UserVal(uv) => {
                if let Some((sg, _meta)) = uv.get() {
                    Some(Self::SketchGroup(sg))
                } else {
                    None
                }
            }
            KclValue::Plane(sg) => Some(Self::SketchSurface(SketchSurface::Plane(sg.clone()))),
            KclValue::Face(sg) => Some(Self::SketchSurface(SketchSurface::Face(sg.clone()))),
            _ => None,
        }
    }
}
impl<'a> FromKclValue<'a> for SketchSurface {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Plane(sg) => Some(Self::Plane(sg.clone())),
            KclValue::Face(sg) => Some(Self::Face(sg.clone())),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for Vec<SketchGroup> {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::UserVal(uv) = arg else {
            return None;
        };

        uv.get::<Vec<SketchGroup>>().map(|x| x.0)
    }
}

impl<'a> FromKclValue<'a> for Vec<u64> {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::UserVal(uv) = arg else {
            return None;
        };

        uv.get::<Vec<u64>>().map(|x| x.0)
    }
}
