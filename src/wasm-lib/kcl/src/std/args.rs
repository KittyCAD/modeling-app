use std::{any::type_name, num::NonZeroU32};

use anyhow::Result;
use kcmc::{websocket::OkWebSocketResponseData, ModelingCmd};
use kittycad_modeling_cmds as kcmc;

use crate::{
    ast::types::TagNode,
    errors::{KclError, KclErrorDetails},
    executor::{
        ExecState, ExecutorContext, ExtrudeSurface, KclValue, Metadata, Sketch, SketchSet, SketchSurface, Solid,
        SolidSet, SourceRange, TagIdentifier,
    },
    std::{shapes::SketchOrSurface, sketch::FaceTag, types::Uint, FnAsArg},
};

use super::shapes::PolygonType;

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
                context_type: crate::executor::ContextType::Mock,
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

    /// Flush just the fillets and chamfers for this specific SolidSet.
    #[allow(clippy::vec_box)]
    pub(crate) async fn flush_batch_for_solid_set(
        &self,
        exec_state: &mut ExecState,
        solids: Vec<Box<Solid>>,
    ) -> Result<(), KclError> {
        // Make sure we don't traverse sketches more than once.
        let mut traversed_sketches = Vec::new();

        // Collect all the fillet/chamfer ids for the solids.
        let mut ids = Vec::new();
        for solid in solids {
            // We need to traverse the solids that share the same sketch.
            let sketch_id = solid.sketch.id;
            if !traversed_sketches.contains(&sketch_id) {
                // Find all the solids on the same shared sketch.
                ids.extend(
                    exec_state
                        .memory
                        .find_solids_on_sketch(solid.sketch.id)
                        .iter()
                        .flat_map(|eg| eg.get_all_edge_cut_ids()),
                );
                ids.extend(exec_state.dynamic_state.edge_cut_ids_on_sketch(sketch_id));
                traversed_sketches.push(sketch_id);
            }

            ids.extend(solid.get_all_edge_cut_ids());
        }

        // We can return early if there are no fillets or chamfers.
        if ids.is_empty() {
            return Ok(());
        }

        // We want to move these fillets and chamfers from batch_end to batch so they get executed
        // before what ever we call next.
        for id in ids {
            // Pop it off the batch_end and add it to the batch.
            let Some(item) = self.ctx.engine.batch_end().lock().unwrap().shift_remove(&id) else {
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

    pub(crate) fn make_user_val_from_point(&self, p: [f64; 2]) -> Result<KclValue, KclError> {
        let meta = Metadata {
            source_range: self.source_range,
        };
        let x = KclValue::Number {
            value: p[0],
            meta: vec![meta],
        };
        let y = KclValue::Number {
            value: p[1],
            meta: vec![meta],
        };
        Ok(KclValue::Array {
            value: vec![x, y],
            meta: vec![meta],
        })
    }

    pub(crate) fn make_user_val_from_f64(&self, f: f64) -> KclValue {
        KclValue::from_number(
            f,
            vec![Metadata {
                source_range: self.source_range,
            }],
        )
    }

    pub(crate) fn make_user_val_from_i64(&self, n: i64) -> KclValue {
        KclValue::Int {
            value: n,
            meta: vec![Metadata {
                source_range: self.source_range,
            }],
        }
    }

    pub(crate) fn make_user_val_from_f64_array(&self, f: Vec<f64>) -> Result<KclValue, KclError> {
        let array = f
            .into_iter()
            .map(|n| KclValue::Number {
                value: n,
                meta: vec![Metadata {
                    source_range: self.source_range,
                }],
            })
            .collect::<Vec<_>>();
        Ok(KclValue::Array {
            value: array,
            meta: vec![Metadata {
                source_range: self.source_range,
            }],
        })
    }

    pub(crate) fn get_number(&self) -> Result<f64, KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_number_array(&self) -> Result<Vec<f64>, KclError> {
        let numbers = self
            .args
            .iter()
            .map(|arg| {
                let Some(num) = f64::from_mem_item(arg) else {
                    return Err(KclError::Semantic(KclErrorDetails {
                        source_ranges: arg.metadata().iter().map(|x| x.source_range).collect(),
                        message: format!("Expected a number but found {}", arg.human_friendly_type()),
                    }));
                };
                Ok(num)
            })
            .collect::<Result<_, _>>()?;
        Ok(numbers)
    }

    pub(crate) fn get_pattern_transform_args(&self) -> Result<(u32, FnAsArg<'_>, SolidSet), KclError> {
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
            crate::std::shapes::CircleData,
            crate::std::shapes::SketchOrSurface,
            Option<TagNode>,
        ),
        KclError,
    > {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_sketches(&self) -> Result<(SketchSet, Sketch), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_sketch(&self) -> Result<Sketch, KclError> {
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

    pub(crate) fn get_sketch_and_optional_tag(&self) -> Result<(Sketch, Option<TagNode>), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_sketches_and_data<'a, T>(&'a self) -> Result<(Vec<Sketch>, Option<T>), KclError>
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

    pub(crate) fn get_data_and_sketch<'a, T>(&'a self) -> Result<(T, Sketch), KclError>
    where
        T: serde::de::DeserializeOwned + FromArgs<'a>,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch_set<'a, T>(&'a self) -> Result<(T, SketchSet), KclError>
    where
        T: serde::de::DeserializeOwned + FromArgs<'a>,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch_and_tag<'a, T>(&'a self) -> Result<(T, Sketch, Option<TagNode>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_sketch_surface<'a, T>(&'a self) -> Result<(T, SketchSurface, Option<TagNode>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_solid_set<'a, T>(&'a self) -> Result<(T, SolidSet), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_solid<'a, T>(&'a self) -> Result<(T, Box<Solid>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_solid_and_tag<'a, T>(&'a self) -> Result<(T, Box<Solid>, Option<TagNode>), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_tag_to_number_sketch(&self) -> Result<(TagIdentifier, f64, Sketch), KclError> {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_data_and_float<'a, T>(&'a self) -> Result<(T, f64), KclError>
    where
        T: serde::de::DeserializeOwned + FromKclValue<'a> + Sized,
    {
        FromArgs::from_args(self, 0)
    }

    pub(crate) fn get_number_sketch_set(&self) -> Result<(f64, SketchSet), KclError> {
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

    pub(crate) fn get_polygon_args(
        &self,
    ) -> Result<
        (
            crate::std::shapes::PolygonData,
            crate::std::shapes::SketchOrSurface,
            Option<TagNode>,
        ),
        KclError,
    > {
        FromArgs::from_args(self, 0)
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

impl<'a> FromArgs<'a> for Vec<KclValue> {
    fn from_args(args: &'a Args, i: usize) -> Result<Self, KclError> {
        let Some(arg) = args.args.get(i) else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected an argument at index {i}"),
                source_ranges: vec![args.source_range],
            }));
        };
        let KclValue::Array { value: array, meta: _ } = arg else {
            let message = format!("Expected an array but found {}", arg.human_friendly_type());
            return Err(KclError::Type(KclErrorDetails {
                source_ranges: arg.metadata().into_iter().map(|m| m.source_range).collect(),
                message,
            }));
        };
        Ok(array.to_owned())
    }
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
                    "Argument at index {i} was supposed to be type Option<{}> but found {}",
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

impl<'a> FromKclValue<'a> for [f64; 2] {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Array { value, meta: _ } = arg else {
            return None;
        };
        if value.len() != 2 {
            return None;
        }
        let v0 = value.first()?;
        let v1 = value.get(1)?;
        let array = [v0.as_f64()?, v1.as_f64()?];
        Some(array)
    }
}

impl<'a> FromKclValue<'a> for [usize; 3] {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Array { value, meta: _ } = arg else {
            return None;
        };
        if value.len() != 3 {
            return None;
        }
        let v0 = value.first()?;
        let v1 = value.get(1)?;
        let v2 = value.get(2)?;
        let array = [v0.as_usize()?, v1.as_usize()?, v2.as_usize()?];
        Some(array)
    }
}

impl<'a> FromKclValue<'a> for [f64; 3] {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Array { value, meta: _ } = arg else {
            return None;
        };
        if value.len() != 3 {
            return None;
        }
        let v0 = value.first()?;
        let v1 = value.get(1)?;
        let v2 = value.get(2)?;
        let array = [v0.as_f64()?, v1.as_f64()?, v2.as_f64()?];
        Some(array)
    }
}

impl<'a> FromKclValue<'a> for TagNode {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        arg.get_tag_declarator().ok()
    }
}

impl<'a> FromKclValue<'a> for TagIdentifier {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        arg.get_tag_identifier().ok()
    }
}

impl<'a> FromKclValue<'a> for KclValue {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        Some(arg.clone())
    }
}

macro_rules! fields {
    ($obj:ident, $typ:ident, $($field:ident),+) => {
        $(
        let $field = $obj.get(stringify!($field))?.$typ()?;
        )+
    };
    ($obj:ident, $typ:ident, $($field:ident $key:literal),+) => {
        $(
        let $field = $obj.get($key)?.$typ()?;
        )+
    };
}

macro_rules! fields_opt {
    ($obj:ident, $typ:ident, $($field:ident),+) => {
        $(
        let $field = $obj.get(stringify!($field)).and_then(|x|x.$typ());
        )+
    };
}

macro_rules! fields_recurse {
    ($obj:ident, $field:ident) => {
        let $field = $obj.get(stringify!($field)).and_then(FromKclValue::from_mem_item)?;
    };
    ($obj:ident, $field:ident $k:literal) => {
        let $field = $obj.get($k).and_then(FromKclValue::from_mem_item)?;
    };
}

macro_rules! fields_recurse_opt {
    ($obj:ident, $field:ident) => {
        let $field = $obj.get(stringify!($field)).and_then(FromKclValue::from_mem_item);
    };
    ($obj:ident, $field:ident, $k:literal) => {
        let $field = $obj.get($k).and_then(FromKclValue::from_mem_item);
    };
}

impl<'a> FromKclValue<'a> for crate::std::import::ImportFormat {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_str, typ "type");
        match typ {
            "fbx" => Some(Self::Fbx {}),
            "gltf" => Some(Self::Gltf {}),
            "sldprt" => Some(Self::Sldprt {}),
            "step" => Some(Self::Step {}),
            "stl" => {
                fields_recurse_opt!(obj, coords);
                fields_recurse!(obj, units);
                Some(Self::Stl { coords, units })
            }
            "obj" => {
                fields_recurse_opt!(obj, coords);
                fields_recurse!(obj, units);
                Some(Self::Obj { coords, units })
            }
            "ply" => {
                fields_recurse_opt!(obj, coords);
                fields_recurse!(obj, units);
                Some(Self::Ply { coords, units })
            }
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for super::sketch::AngledLineThatIntersectsData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields_recurse!(obj, angle);
        fields_recurse!(obj, intersect_tag "intersectTag");
        fields_recurse_opt!(obj, offset);
        Some(Self {
            angle,
            intersect_tag,
            offset,
        })
    }
}

impl<'a> FromKclValue<'a> for super::shapes::PolygonData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields_recurse!(obj, radius);
        fields_recurse!(obj, num_sides "numSides");
        fields_recurse!(obj, center);
        fields_recurse!(obj, inscribed);
        let polygon_type = if inscribed {
            PolygonType::Inscribed
        } else {
            PolygonType::Circumscribed
        };
        Some(Self {
            radius,
            num_sides,
            center,
            polygon_type,
            inscribed,
        })
    }
}

impl<'a> FromKclValue<'a> for crate::std::polar::PolarCoordsData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields_recurse!(obj, angle);
        fields_recurse!(obj, length);
        Some(Self { angle, length })
    }
}

impl<'a> FromKclValue<'a> for crate::std::loft::LoftData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields_recurse_opt!(obj, v_degree);
        fields_recurse_opt!(obj, bez_approximate_rational);
        fields_recurse_opt!(obj, base_curve_index);
        fields_recurse_opt!(obj, tolerance);
        Some(Self {
            v_degree,
            bez_approximate_rational,
            base_curve_index,
            tolerance,
        })
    }
}

impl<'a> FromKclValue<'a> for crate::std::planes::StandardPlane {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        match s {
            "XY" | "xy" => Some(Self::XY),
            "-XY" | "-xy" => Some(Self::NegXY),
            "XZ" | "xz" => Some(Self::XZ),
            "-XZ" | "-xz" => Some(Self::NegXZ),
            "YZ" | "yz" => Some(Self::YZ),
            "-YZ" | "-yz" => Some(Self::NegYZ),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for crate::executor::Plane {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_uuid, id);
        fields_recurse!(obj, value);
        fields_recurse!(obj, origin);
        fields_recurse!(obj, x_axis "xAxis");
        fields_recurse!(obj, y_axis "yAxis");
        fields_recurse!(obj, z_axis "zAxis");
        fields_recurse!(obj, meta "__meta");
        Some(Self {
            id,
            value,
            origin,
            x_axis,
            y_axis,
            z_axis,
            meta,
        })
    }
}

impl<'a> FromKclValue<'a> for crate::executor::PlaneType {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let plane_type = match arg.as_str()? {
            "XY" | "xy" => Self::XY,
            "XZ" | "xz" => Self::XZ,
            "YZ" | "yz" => Self::YZ,
            "Custom" => Self::Custom,
            _ => return None,
        };
        Some(plane_type)
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::units::UnitLength {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        s.parse().ok()
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::System {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields_recurse!(obj, forward);
        fields_recurse!(obj, up);
        Some(Self { forward, up })
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::AxisDirectionPair {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields_recurse!(obj, axis);
        fields_recurse!(obj, direction);
        Some(Self { axis, direction })
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::Axis {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        match s {
            "y" => Some(Self::Y),
            "z" => Some(Self::Z),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for PolygonType {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        match s {
            "inscribed" => Some(Self::Inscribed),
            _ => Some(Self::Circumscribed),
        }
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::Direction {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        match s {
            "positive" => Some(Self::Positive),
            "negative" => Some(Self::Negative),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for super::patterns::CircularPattern3dData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_f64, instances);
        fields!(obj, as_f64, arc_degrees "arcDegrees");
        fields!(obj, as_bool, rotate_duplicates "rotateDuplicates");
        let instances = Uint::new(instances);
        fields_recurse!(obj, axis);
        fields_recurse!(obj, center);
        Some(Self {
            instances,
            axis,
            center,
            arc_degrees,
            rotate_duplicates,
        })
    }
}

impl<'a> FromKclValue<'a> for super::patterns::CircularPattern2dData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_f64, instances);
        fields!(obj, as_f64, arc_degrees "arcDegrees");
        fields!(obj, as_bool, rotate_duplicates "rotateDuplicates");
        let instances = Uint::new(instances);
        fields_recurse!(obj, center);
        Some(Self {
            instances,
            center,
            arc_degrees,
            rotate_duplicates,
        })
    }
}

impl<'a> FromKclValue<'a> for super::patterns::LinearPattern3dData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_f64, instances, distance);
        let instances = Uint::new(instances);
        fields_recurse!(obj, axis);
        Some(Self {
            instances,
            distance,
            axis,
        })
    }
}

impl<'a> FromKclValue<'a> for super::patterns::LinearPattern2dData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_f64, instances, distance);
        let instances = Uint::new(instances);
        fields_recurse!(obj, axis);
        Some(Self {
            instances,
            distance,
            axis,
        })
    }
}

impl<'a> FromKclValue<'a> for super::sketch::BezierData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_point2d, to, control1, control2);
        Some(Self { to, control1, control2 })
    }
}

impl<'a> FromKclValue<'a> for super::shell::ShellData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_f64, thickness);
        fields_recurse!(obj, faces);
        Some(Self { thickness, faces })
    }
}

impl<'a> FromKclValue<'a> for super::chamfer::ChamferData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_f64, length);
        fields_recurse!(obj, tags);
        Some(Self { length, tags })
    }
}

impl<'a> FromKclValue<'a> for super::fillet::FilletData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_f64, radius);
        fields_opt!(obj, as_f64, tolerance);
        fields_recurse!(obj, tags);
        Some(Self {
            radius,
            tolerance,
            tags,
        })
    }
}

impl<'a> FromKclValue<'a> for super::helix::HelixData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_f64, revolutions);
        fields_opt!(obj, as_f64, length);
        fields_opt!(obj, as_bool, ccw);
        let ccw = ccw.unwrap_or_default();
        let angle_start = obj.get("angleStart").or_else(|| obj.get("angle_start"))?.as_f64()?;
        Some(Self {
            revolutions,
            angle_start,
            ccw,
            length,
        })
    }
}

impl<'a> FromKclValue<'a> for FaceTag {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let case1 = || match arg.as_str() {
            Some("start" | "START") => Some(Self::StartOrEnd(super::sketch::StartOrEnd::Start)),
            Some("end" | "END") => Some(Self::StartOrEnd(super::sketch::StartOrEnd::End)),
            _ => None,
        };
        let case2 = || {
            let tag = TagIdentifier::from_mem_item(arg)?;
            Some(Self::Tag(Box::new(tag)))
        };
        case1().or_else(case2)
    }
}

impl<'a> FromKclValue<'a> for super::sketch::AngledLineToData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        // Deserialize from an {angle, to} object.
        let case1 = || {
            let obj = arg.as_object()?;
            fields!(obj, as_f64, angle, to);
            Some(Self { angle, to })
        };
        // Deserialize from an [angle, to] array.
        let case2 = || {
            let [angle, to] = arg.as_point2d()?;
            Some(Self { angle, to })
        };
        case1().or_else(case2)
    }
}

impl<'a> FromKclValue<'a> for super::sketch::ArcData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_f64, radius);
        let case1 = || {
            let angle_start = obj.get("angleStart").or_else(|| obj.get("angle_start"))?.as_f64()?;
            let angle_end = obj.get("angleEnd").or_else(|| obj.get("angle_end"))?.as_f64()?;
            Some(Self::AnglesAndRadius {
                angle_start,
                angle_end,
                radius,
            })
        };
        let case2 = || {
            let obj = arg.as_object()?;
            fields!(obj, as_point2d, center, to);
            Some(Self::CenterToRadius { center, to, radius })
        };
        case1().or_else(case2)
    }
}

impl<'a> FromKclValue<'a> for super::revolve::RevolveData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let angle = obj.get("angle").and_then(|x| x.as_f64());
        let tolerance = obj.get("tolerance").and_then(|x| x.as_f64());
        fields_recurse!(obj, axis);
        Some(Self { angle, axis, tolerance })
    }
}

impl<'a> FromKclValue<'a> for super::shapes::CircleData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_point2d, center);
        fields!(obj, as_f64, radius);
        Some(Self { center, radius })
    }
}

impl<'a> FromKclValue<'a> for super::sketch::TangentialArcData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_f64, radius, offset);
        Some(Self::RadiusAndOffset { radius, offset })
    }
}

impl<'a> FromKclValue<'a> for crate::executor::Point3d {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        // Case 1: object with x/y/z fields
        if let Some(obj) = arg.as_object() {
            fields!(obj, as_f64, x, y, z);
            return Some(Self { x, y, z });
        }
        // Case 2: Array of 3 numbers.
        let [x, y, z]: [f64; 3] = FromKclValue::from_mem_item(arg)?;
        Some(Self { x, y, z })
    }
}

impl<'a> FromKclValue<'a> for super::sketch::PlaneData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        // Case 0: actual plane
        if let KclValue::Plane(p) = arg {
            return Some(Self::Plane {
                origin: Box::new(p.origin),
                x_axis: Box::new(p.x_axis),
                y_axis: Box::new(p.y_axis),
                z_axis: Box::new(p.z_axis),
            });
        }
        // Case 1: predefined plane
        if let Some(s) = arg.as_str() {
            return match s {
                "XY" | "xy" => Some(Self::XY),
                "-XY" | "-xy" => Some(Self::NegXY),
                "XZ" | "xz" => Some(Self::XZ),
                "-XZ" | "-xz" => Some(Self::NegXZ),
                "YZ" | "yz" => Some(Self::YZ),
                "-YZ" | "-yz" => Some(Self::NegYZ),
                _ => None,
            };
        }
        // Case 2: custom plane
        let obj = arg.as_object()?;
        fields!(obj, as_object, plane);
        let origin = plane
            .get("origin")
            .and_then(FromKclValue::from_mem_item)
            .map(Box::new)?;
        let x_axis = plane
            .get("xAxis")
            .or_else(|| plane.get("x_axis"))
            .and_then(FromKclValue::from_mem_item)
            .map(Box::new)?;
        let y_axis = plane
            .get("yAxis")
            .or_else(|| plane.get("y_axis"))
            .and_then(FromKclValue::from_mem_item)
            .map(Box::new)?;
        let z_axis = plane
            .get("zAxis")
            .or_else(|| plane.get("z_axis"))
            .and_then(FromKclValue::from_mem_item)
            .map(Box::new)?;
        Some(Self::Plane {
            origin,
            x_axis,
            y_axis,
            z_axis,
        })
    }
}

impl<'a> FromKclValue<'a> for crate::executor::ExtrudePlane {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_uuid, face_id "faceId");
        let tag = FromKclValue::from_mem_item(obj.get("tag")?);
        fields_recurse!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for crate::executor::ExtrudeArc {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_uuid, face_id "faceId");
        let tag = FromKclValue::from_mem_item(obj.get("tag")?);
        fields_recurse!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for crate::executor::GeoMeta {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_uuid, id);
        fields_recurse!(obj, source_range "sourceRange");
        let source_range = SourceRange(source_range);
        Some(Self {
            id,
            metadata: Metadata { source_range },
        })
    }
}

impl<'a> FromKclValue<'a> for crate::executor::ChamferSurface {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_uuid, face_id "faceId");
        let tag = FromKclValue::from_mem_item(obj.get("tag")?);
        fields_recurse!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for crate::executor::FilletSurface {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_uuid, face_id "faceId");
        let tag = FromKclValue::from_mem_item(obj.get("tag")?);
        fields_recurse!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for ExtrudeSurface {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let case1 = crate::executor::ExtrudePlane::from_mem_item;
        let case2 = crate::executor::ExtrudeArc::from_mem_item;
        let case3 = crate::executor::ChamferSurface::from_mem_item;
        let case4 = crate::executor::FilletSurface::from_mem_item;
        case1(arg)
            .map(Self::ExtrudePlane)
            .or_else(|| case2(arg).map(Self::ExtrudeArc))
            .or_else(|| case3(arg).map(Self::Chamfer))
            .or_else(|| case4(arg).map(Self::Fillet))
    }
}

impl<'a> FromKclValue<'a> for crate::executor::EdgeCut {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields!(obj, as_str, typ "type");
        let tag = Box::new(obj.get("tag").and_then(FromKclValue::from_mem_item));
        fields!(obj, as_uuid, edge_id "edgeId");
        fields!(obj, as_uuid, id);
        match typ {
            "fillet" => {
                fields!(obj, as_f64, radius);
                Some(Self::Fillet {
                    edge_id,
                    tag,
                    id,
                    radius,
                })
            }
            "chamfer" => {
                fields!(obj, as_f64, length);
                Some(Self::Chamfer {
                    id,
                    length,
                    edge_id,
                    tag,
                })
            }
            _ => None,
        }
    }
}

macro_rules! impl_from_kcl_for_vec {
    ($typ:path) => {
        impl<'a> FromKclValue<'a> for Vec<$typ> {
            fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
                arg.as_array()?
                    .iter()
                    .map(|value| FromKclValue::from_mem_item(value))
                    .collect::<Option<_>>()
            }
        }
    };
}

impl_from_kcl_for_vec!(FaceTag);
impl_from_kcl_for_vec!(crate::executor::EdgeCut);
impl_from_kcl_for_vec!(crate::executor::Metadata);
impl_from_kcl_for_vec!(super::fillet::EdgeReference);
impl_from_kcl_for_vec!(ExtrudeSurface);
impl_from_kcl_for_vec!(Sketch);

impl<'a> FromKclValue<'a> for crate::executor::SourceRange {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        FromKclValue::from_mem_item(arg).map(crate::executor::SourceRange)
    }
}

impl<'a> FromKclValue<'a> for crate::executor::Metadata {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        FromKclValue::from_mem_item(arg).map(|sr| Self { source_range: sr })
    }
}

impl<'a> FromKclValue<'a> for crate::executor::Solid {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        arg.as_solid().cloned()
    }
}

impl<'a> FromKclValue<'a> for super::sketch::SketchData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let case1 = super::sketch::PlaneData::from_mem_item;
        let case2 = crate::executor::Solid::from_mem_item;
        let case3 = crate::executor::Plane::from_mem_item;
        case1(arg)
            .map(Self::PlaneOrientation)
            .or_else(|| case2(arg).map(Box::new).map(Self::Solid))
            .or_else(|| case3(arg).map(Box::new).map(Self::Plane))
    }
}

impl<'a> FromKclValue<'a> for super::revolve::AxisAndOrigin {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        // Case 1: predefined planes.
        if let Some(s) = arg.as_str() {
            return match s {
                "X" | "x" => Some(Self::X),
                "Y" | "y" => Some(Self::Y),
                "-X" | "-x" => Some(Self::NegX),
                "-Y" | "-y" => Some(Self::NegY),
                _ => None,
            };
        }
        // Case 2: custom planes.
        let obj = arg.as_object()?;
        fields!(obj, as_object, custom);
        fields!(custom, as_point2d, axis, origin);
        Some(Self::Custom { axis, origin })
    }
}

impl<'a> FromKclValue<'a> for super::fillet::EdgeReference {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let id = arg.as_uuid().map(Self::Uuid);
        let tag = || TagIdentifier::from_mem_item(arg).map(Box::new).map(Self::Tag);
        id.or_else(tag)
    }
}

impl<'a> FromKclValue<'a> for super::revolve::AxisOrEdgeReference {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let case1 = super::revolve::AxisAndOrigin::from_mem_item;
        let case2 = super::fillet::EdgeReference::from_mem_item;
        case1(arg).map(Self::Axis).or_else(|| case2(arg).map(Self::Edge))
    }
}

impl<'a> FromKclValue<'a> for super::mirror::Mirror2dData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        fields_recurse!(obj, axis);
        Some(Self { axis })
    }
}

impl<'a> FromKclValue<'a> for super::sketch::AngledLineData {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let case1 = |arg: &KclValue| {
            let obj = arg.as_object()?;
            fields!(obj, as_f64, angle, length);
            Some(Self::AngleAndLengthNamed { angle, length })
        };
        let case2 = |arg: &KclValue| {
            let array = arg.as_array()?;
            let ang = array.first()?.as_f64()?;
            let len = array.get(1)?.as_f64()?;
            Some(Self::AngleAndLengthPair([ang, len]))
        };
        case1(arg).or_else(|| case2(arg))
    }
}

impl<'a> FromKclValue<'a> for i64 {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Int { value, meta: _ } = arg else {
            return None;
        };
        Some(*value)
    }
}

impl<'a> FromKclValue<'a> for u32 {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Int { value, meta: _ } = arg else {
            return None;
        };
        Some(*value as u32)
    }
}

impl<'a> FromKclValue<'a> for NonZeroU32 {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        u32::from_mem_item(arg).and_then(|x| x.try_into().ok())
    }
}

impl<'a> FromKclValue<'a> for u64 {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Int { value, meta: _ } = arg else {
            return None;
        };
        Some(*value as u64)
    }
}
impl<'a> FromKclValue<'a> for f64 {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Number { value, meta: _ } => Some(*value),
            KclValue::Int { value, meta: _ } => Some(*value as f64),
            _ => None,
        }
    }
}
impl<'a> FromKclValue<'a> for Sketch {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Sketch { value } = arg else {
            return None;
        };
        Some(value.as_ref().to_owned())
    }
}
impl<'a> FromKclValue<'a> for String {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::String { value, meta: _ } = arg else {
            return None;
        };
        Some(value.to_owned())
    }
}
impl<'a> FromKclValue<'a> for crate::ast::types::KclNone {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::KclNone { value, meta: _ } = arg else {
            return None;
        };
        Some(value.to_owned())
    }
}
impl<'a> FromKclValue<'a> for bool {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Bool { value, meta: _ } = arg else {
            return None;
        };
        Some(*value)
    }
}

impl<'a> FromKclValue<'a> for SketchSet {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Sketch { value: sketch } => Some(SketchSet::from(sketch.to_owned())),
            KclValue::Sketches { value } => Some(SketchSet::from(value.to_owned())),
            KclValue::Array { .. } => {
                let v: Option<Vec<Sketch>> = FromKclValue::from_mem_item(arg);
                Some(SketchSet::Sketches(v?.iter().cloned().map(Box::new).collect()))
            }
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for Box<Solid> {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Solid(s) = arg else {
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

impl<'a> FromKclValue<'a> for SolidSet {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        arg.get_solid_set().ok()
    }
}

impl<'a> FromKclValue<'a> for SketchOrSurface {
    fn from_mem_item(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Sketch { value: sg } => Some(Self::Sketch(sg.to_owned())),
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

impl From<Args> for Metadata {
    fn from(value: Args) -> Self {
        Self {
            source_range: value.source_range,
        }
    }
}

impl From<Args> for Vec<Metadata> {
    fn from(value: Args) -> Self {
        vec![Metadata {
            source_range: value.source_range,
        }]
    }
}
