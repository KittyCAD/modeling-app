use std::num::NonZeroU32;

use anyhow::Result;
use schemars::JsonSchema;
use serde::Serialize;

use super::fillet::EdgeReference;
pub use crate::execution::fn_call::Args;
use crate::{
    ModuleId,
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecState, ExtrudeSurface, Helix, KclObjectFields, KclValue, Metadata, PlaneInfo, Sketch, SketchSurface, Solid,
        TagIdentifier,
        kcl_value::FunctionSource,
        types::{NumericType, PrimitiveType, RuntimeType, UnitAngle, UnitLen, UnitType},
    },
    parsing::ast::types::TagNode,
    source_range::SourceRange,
    std::{
        shapes::{PolygonType, SketchOrSurface},
        sketch::FaceTag,
        sweep::SweepPath,
    },
};

const ERROR_STRING_SKETCH_TO_SOLID_HELPER: &str =
    "You can convert a sketch (2D) into a Solid (3D) by calling a function like `extrude` or `revolve`";

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TyF64 {
    pub n: f64,
    pub ty: NumericType,
}

impl TyF64 {
    pub fn new(n: f64, ty: NumericType) -> Self {
        Self { n, ty }
    }

    pub fn to_mm(&self) -> f64 {
        self.to_length_units(UnitLen::Mm)
    }

    pub fn to_length_units(&self, units: UnitLen) -> f64 {
        let len = match &self.ty {
            NumericType::Default { len, .. } => *len,
            NumericType::Known(UnitType::Length(len)) => *len,
            t => unreachable!("expected length, found {t:?}"),
        };

        debug_assert_ne!(len, UnitLen::Unknown);

        len.adjust_to(self.n, units).0
    }

    pub fn to_degrees(&self) -> f64 {
        let angle = match self.ty {
            NumericType::Default { angle, .. } => angle,
            NumericType::Known(UnitType::Angle(angle)) => angle,
            _ => unreachable!(),
        };

        debug_assert_ne!(angle, UnitAngle::Unknown);

        angle.adjust_to(self.n, UnitAngle::Degrees).0
    }

    pub fn to_radians(&self) -> f64 {
        let angle = match self.ty {
            NumericType::Default { angle, .. } => angle,
            NumericType::Known(UnitType::Angle(angle)) => angle,
            _ => unreachable!(),
        };

        debug_assert_ne!(angle, UnitAngle::Unknown);

        angle.adjust_to(self.n, UnitAngle::Radians).0
    }
    pub fn count(n: f64) -> Self {
        Self {
            n,
            ty: NumericType::count(),
        }
    }

    pub fn map_value(mut self, n: f64) -> Self {
        self.n = n;
        self
    }
}

impl JsonSchema for TyF64 {
    fn schema_name() -> String {
        "TyF64".to_string()
    }

    fn json_schema(r#gen: &mut schemars::r#gen::SchemaGenerator) -> schemars::schema::Schema {
        r#gen.subschema_for::<f64>()
    }
}

impl Args {
    pub(crate) fn get_kw_arg_opt<T>(
        &self,
        label: &str,
        ty: &RuntimeType,
        exec_state: &mut ExecState,
    ) -> Result<Option<T>, KclError>
    where
        T: for<'a> FromKclValue<'a>,
    {
        match self.kw_args.labeled.get(label) {
            None => return Ok(None),
            Some(a) => {
                if let KclValue::KclNone { .. } = &a.value {
                    return Ok(None);
                }
            }
        }

        self.get_kw_arg(label, ty, exec_state).map(Some)
    }

    pub(crate) fn get_kw_arg<T>(&self, label: &str, ty: &RuntimeType, exec_state: &mut ExecState) -> Result<T, KclError>
    where
        T: for<'a> FromKclValue<'a>,
    {
        let Some(arg) = self.kw_args.labeled.get(label) else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("This function requires a keyword argument `{label}`"),
                vec![self.source_range],
            )));
        };

        let arg = arg.value.coerce(ty, true, exec_state).map_err(|_| {
            let actual_type = arg.value.principal_type();
            let actual_type_name = actual_type
                .as_ref()
                .map(|t| t.to_string())
                .unwrap_or_else(|| arg.value.human_friendly_type().to_owned());
            let msg_base = format!(
                "This function expected its `{label}` argument to be {} but it's actually of type {actual_type_name}",
                ty.human_friendly_type(),
            );
            let suggestion = match (ty, actual_type) {
                (RuntimeType::Primitive(PrimitiveType::Solid), Some(RuntimeType::Primitive(PrimitiveType::Sketch))) => {
                    Some(ERROR_STRING_SKETCH_TO_SOLID_HELPER)
                }
                (RuntimeType::Array(t, _), Some(RuntimeType::Primitive(PrimitiveType::Sketch)))
                    if **t == RuntimeType::Primitive(PrimitiveType::Solid) =>
                {
                    Some(ERROR_STRING_SKETCH_TO_SOLID_HELPER)
                }
                _ => None,
            };
            let mut message = match suggestion {
                None => msg_base,
                Some(sugg) => format!("{msg_base}. {sugg}"),
            };
            if message.contains("one or more Solids or ImportedGeometry but it's actually of type Sketch") {
                message = format!("{message}. {ERROR_STRING_SKETCH_TO_SOLID_HELPER}");
            }
            KclError::new_semantic(KclErrorDetails::new(message, arg.source_ranges()))
        })?;

        T::from_kcl_val(&arg).ok_or_else(|| {
            KclError::new_internal(KclErrorDetails::new(
                format!("Mismatch between type coercion and value extraction (this isn't your fault).\nTo assist in bug-reporting, expected type: {ty:?}; actual value: {arg:?}"),
                vec![self.source_range],
           ))
        })
    }

    /// Get a labelled keyword arg, check it's an array, and return all items in the array
    /// plus their source range.
    pub(crate) fn kw_arg_edge_array_and_source(
        &self,
        label: &str,
    ) -> Result<Vec<(EdgeReference, SourceRange)>, KclError> {
        let Some(arg) = self.kw_args.labeled.get(label) else {
            let err = KclError::new_semantic(KclErrorDetails::new(
                format!("This function requires a keyword argument '{label}'"),
                vec![self.source_range],
            ));
            return Err(err);
        };
        arg.value
            .clone()
            .into_array()
            .iter()
            .map(|item| {
                let source = SourceRange::from(item);
                let val = FromKclValue::from_kcl_val(item).ok_or_else(|| {
                    KclError::new_semantic(KclErrorDetails::new(
                        format!("Expected an Edge but found {}", arg.value.human_friendly_type()),
                        arg.source_ranges(),
                    ))
                })?;
                Ok((val, source))
            })
            .collect::<Result<Vec<_>, _>>()
    }

    pub(crate) fn get_unlabeled_kw_arg_array_and_type(
        &self,
        label: &str,
        exec_state: &mut ExecState,
    ) -> Result<(Vec<KclValue>, RuntimeType), KclError> {
        let value = self.get_unlabeled_kw_arg(label, &RuntimeType::any_array(), exec_state)?;
        Ok(match value {
            KclValue::HomArray { value, ty } => (value, ty),
            KclValue::Tuple { value, .. } => (value, RuntimeType::any()),
            val => (vec![val], RuntimeType::any()),
        })
    }

    /// Get the unlabeled keyword argument. If not set, returns Err. If it
    /// can't be converted to the given type, returns Err.
    pub(crate) fn get_unlabeled_kw_arg<T>(
        &self,
        label: &str,
        ty: &RuntimeType,
        exec_state: &mut ExecState,
    ) -> Result<T, KclError>
    where
        T: for<'a> FromKclValue<'a>,
    {
        let arg = self
            .unlabeled_kw_arg_unconverted()
            .ok_or(KclError::new_semantic(KclErrorDetails::new(
                format!("This function requires a value for the special unlabeled first parameter, '{label}'"),
                vec![self.source_range],
            )))?;

        let arg = arg.value.coerce(ty, true, exec_state).map_err(|_| {
            let actual_type = arg.value.principal_type();
            let actual_type_name = actual_type
                .as_ref()
                .map(|t| t.to_string())
                .unwrap_or_else(|| arg.value.human_friendly_type().to_owned());
            let msg_base = format!(
                "This function expected the input argument to be {} but it's actually of type {actual_type_name}",
                ty.human_friendly_type(),
            );
            let suggestion = match (ty, actual_type) {
                (RuntimeType::Primitive(PrimitiveType::Solid), Some(RuntimeType::Primitive(PrimitiveType::Sketch))) => {
                    Some(ERROR_STRING_SKETCH_TO_SOLID_HELPER)
                }
                (RuntimeType::Array(ty, _), Some(RuntimeType::Primitive(PrimitiveType::Sketch)))
                    if **ty == RuntimeType::Primitive(PrimitiveType::Solid) =>
                {
                    Some(ERROR_STRING_SKETCH_TO_SOLID_HELPER)
                }
                _ => None,
            };
            let mut message = match suggestion {
                None => msg_base,
                Some(sugg) => format!("{msg_base}. {sugg}"),
            };

            if message.contains("one or more Solids or ImportedGeometry but it's actually of type Sketch") {
                message = format!("{message}. {ERROR_STRING_SKETCH_TO_SOLID_HELPER}");
            }
            KclError::new_semantic(KclErrorDetails::new(message, arg.source_ranges()))
        })?;

        T::from_kcl_val(&arg).ok_or_else(|| {
            KclError::new_internal(KclErrorDetails::new(
                format!("Mismatch between type coercion and value extraction (this isn't your fault).\nTo assist in bug-reporting, expected type: {ty:?}; actual value: {arg:?}"),
                vec![self.source_range],
           ))
        })
    }

    // TODO: Move this to the modeling module.
    fn get_tag_info_from_memory<'a, 'e>(
        &'a self,
        exec_state: &'e mut ExecState,
        tag: &'a TagIdentifier,
    ) -> Result<&'e crate::execution::TagEngineInfo, KclError> {
        if let (epoch, KclValue::TagIdentifier(t)) =
            exec_state.stack().get_from_call_stack(&tag.value, self.source_range)?
        {
            let info = t.get_info(epoch).ok_or_else(|| {
                KclError::new_type(KclErrorDetails::new(
                    format!("Tag `{}` does not have engine info", tag.value),
                    vec![self.source_range],
                ))
            })?;
            Ok(info)
        } else {
            Err(KclError::new_type(KclErrorDetails::new(
                format!("Tag `{}` does not exist", tag.value),
                vec![self.source_range],
            )))
        }
    }

    // TODO: Move this to the modeling module.
    pub(crate) fn get_tag_engine_info<'a, 'e>(
        &'a self,
        exec_state: &'e mut ExecState,
        tag: &'a TagIdentifier,
    ) -> Result<&'a crate::execution::TagEngineInfo, KclError>
    where
        'e: 'a,
    {
        if let Some(info) = tag.get_cur_info() {
            return Ok(info);
        }

        self.get_tag_info_from_memory(exec_state, tag)
    }

    // TODO: Move this to the modeling module.
    fn get_tag_engine_info_check_surface<'a, 'e>(
        &'a self,
        exec_state: &'e mut ExecState,
        tag: &'a TagIdentifier,
    ) -> Result<&'a crate::execution::TagEngineInfo, KclError>
    where
        'e: 'a,
    {
        if let Some(info) = tag.get_cur_info() {
            if info.surface.is_some() {
                return Ok(info);
            }
        }

        self.get_tag_info_from_memory(exec_state, tag)
    }

    pub(crate) fn make_kcl_val_from_point(&self, p: [f64; 2], ty: NumericType) -> Result<KclValue, KclError> {
        let meta = Metadata {
            source_range: self.source_range,
        };
        let x = KclValue::Number {
            value: p[0],
            meta: vec![meta],
            ty,
        };
        let y = KclValue::Number {
            value: p[1],
            meta: vec![meta],
            ty,
        };
        let ty = RuntimeType::Primitive(PrimitiveType::Number(ty));

        Ok(KclValue::HomArray { value: vec![x, y], ty })
    }

    pub(super) fn make_user_val_from_f64_with_type(&self, f: TyF64) -> KclValue {
        KclValue::from_number_with_type(
            f.n,
            f.ty,
            vec![Metadata {
                source_range: self.source_range,
            }],
        )
    }

    // TODO: Move this to the modeling module.
    pub(crate) async fn get_adjacent_face_to_tag(
        &self,
        exec_state: &mut ExecState,
        tag: &TagIdentifier,
        must_be_planar: bool,
    ) -> Result<uuid::Uuid, KclError> {
        if tag.value.is_empty() {
            return Err(KclError::new_type(KclErrorDetails::new(
                "Expected a non-empty tag for the face".to_string(),
                vec![self.source_range],
            )));
        }

        let engine_info = self.get_tag_engine_info_check_surface(exec_state, tag)?;

        let surface = engine_info.surface.as_ref().ok_or_else(|| {
            KclError::new_type(KclErrorDetails::new(
                format!("Tag `{}` does not have a surface", tag.value),
                vec![self.source_range],
            ))
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
            ExtrudeSurface::ExtrudeArc(_) if must_be_planar => Some(Err(KclError::new_type(KclErrorDetails::new(
                format!("Tag `{}` is a non-planar surface", tag.value),
                vec![self.source_range],
            )))),
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
            ExtrudeSurface::Fillet(_) if must_be_planar => Some(Err(KclError::new_type(KclErrorDetails::new(
                format!("Tag `{}` is a non-planar surface", tag.value),
                vec![self.source_range],
            )))),
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
        Err(KclError::new_type(KclErrorDetails::new(
            format!("Expected a face with the tag `{}`", tag.value),
            vec![self.source_range],
        )))
    }
}

/// Types which impl this trait can be extracted from a `KclValue`.
pub trait FromKclValue<'a>: Sized {
    /// Try to convert a KclValue into this type.
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self>;
}

impl<'a> FromKclValue<'a> for TagNode {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.get_tag_declarator().ok()
    }
}

impl<'a> FromKclValue<'a> for TagIdentifier {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.get_tag_identifier().ok()
    }
}

impl<'a> FromKclValue<'a> for Vec<TagIdentifier> {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::HomArray { value, .. } => {
                let tags = value.iter().map(|v| v.get_tag_identifier().unwrap()).collect();
                Some(tags)
            }
            KclValue::Tuple { value, .. } => {
                let tags = value.iter().map(|v| v.get_tag_identifier().unwrap()).collect();
                Some(tags)
            }
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for Vec<KclValue> {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        Some(arg.clone().into_array())
    }
}

impl<'a> FromKclValue<'a> for KclValue {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        Some(arg.clone())
    }
}

macro_rules! let_field_of {
    // Optional field
    ($obj:ident, $field:ident?) => {
        let $field = $obj.get(stringify!($field)).and_then(FromKclValue::from_kcl_val);
    };
    // Optional field but with a different string used as the key
    ($obj:ident, $field:ident? $key:literal) => {
        let $field = $obj.get($key).and_then(FromKclValue::from_kcl_val);
    };
    // Mandatory field, but with a different string used as the key.
    ($obj:ident, $field:ident $key:literal) => {
        let $field = $obj.get($key).and_then(FromKclValue::from_kcl_val)?;
    };
    // Mandatory field, optionally with a type annotation
    ($obj:ident, $field:ident $(, $annotation:ty)?) => {
        let $field $(: $annotation)? = $obj.get(stringify!($field)).and_then(FromKclValue::from_kcl_val)?;
    };
}

impl<'a> FromKclValue<'a> for crate::execution::Plane {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.as_plane().cloned()
    }
}

impl<'a> FromKclValue<'a> for crate::execution::PlaneType {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
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
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        s.parse().ok()
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::System {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, forward);
        let_field_of!(obj, up);
        Some(Self { forward, up })
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::AxisDirectionPair {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, axis);
        let_field_of!(obj, direction);
        Some(Self { axis, direction })
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::Axis {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        match s {
            "y" => Some(Self::Y),
            "z" => Some(Self::Z),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for PolygonType {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        match s {
            "inscribed" => Some(Self::Inscribed),
            _ => Some(Self::Circumscribed),
        }
    }
}

impl<'a> FromKclValue<'a> for kittycad_modeling_cmds::coord::Direction {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let s = arg.as_str()?;
        match s {
            "positive" => Some(Self::Positive),
            "negative" => Some(Self::Negative),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for crate::execution::Geometry {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Sketch { value } => Some(Self::Sketch(*value.to_owned())),
            KclValue::Solid { value } => Some(Self::Solid(*value.to_owned())),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for crate::execution::GeometryWithImportedGeometry {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Sketch { value } => Some(Self::Sketch(*value.to_owned())),
            KclValue::Solid { value } => Some(Self::Solid(*value.to_owned())),
            KclValue::ImportedGeometry(value) => Some(Self::ImportedGeometry(Box::new(value.clone()))),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for FaceTag {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = || match arg.as_str() {
            Some("start" | "START") => Some(Self::StartOrEnd(super::sketch::StartOrEnd::Start)),
            Some("end" | "END") => Some(Self::StartOrEnd(super::sketch::StartOrEnd::End)),
            _ => None,
        };
        let case2 = || {
            let tag = TagIdentifier::from_kcl_val(arg)?;
            Some(Self::Tag(Box::new(tag)))
        };
        case1().or_else(case2)
    }
}

impl<'a> FromKclValue<'a> for super::sketch::TangentialArcData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, radius);
        let_field_of!(obj, offset);
        Some(Self::RadiusAndOffset { radius, offset })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::Point3d {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        // Case 1: object with x/y/z fields
        if let Some(obj) = arg.as_object() {
            let_field_of!(obj, x, TyF64);
            let_field_of!(obj, y, TyF64);
            let_field_of!(obj, z, TyF64);
            // TODO here and below we could use coercing combination.
            let (a, ty) = NumericType::combine_eq_array(&[x, y, z]);
            return Some(Self {
                x: a[0],
                y: a[1],
                z: a[2],
                units: ty.as_length().unwrap_or(UnitLen::Unknown),
            });
        }
        // Case 2: Array of 3 numbers.
        let [x, y, z]: [TyF64; 3] = FromKclValue::from_kcl_val(arg)?;
        let (a, ty) = NumericType::combine_eq_array(&[x, y, z]);
        Some(Self {
            x: a[0],
            y: a[1],
            z: a[2],
            units: ty.as_length().unwrap_or(UnitLen::Unknown),
        })
    }
}

impl<'a> FromKclValue<'a> for super::sketch::PlaneData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        // Case 0: actual plane
        if let KclValue::Plane { value } = arg {
            return Some(Self::Plane(PlaneInfo {
                origin: value.info.origin,
                x_axis: value.info.x_axis,
                y_axis: value.info.y_axis,
                z_axis: value.info.z_axis,
            }));
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
        let_field_of!(obj, plane, &KclObjectFields);
        let origin = plane.get("origin").and_then(FromKclValue::from_kcl_val)?;
        let x_axis: crate::execution::Point3d = plane.get("xAxis").and_then(FromKclValue::from_kcl_val)?;
        let y_axis = plane.get("yAxis").and_then(FromKclValue::from_kcl_val)?;
        let z_axis = x_axis.axes_cross_product(&y_axis);
        Some(Self::Plane(PlaneInfo {
            origin,
            x_axis,
            y_axis,
            z_axis,
        }))
    }
}

impl<'a> FromKclValue<'a> for crate::execution::ExtrudePlane {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, face_id "faceId");
        let tag = FromKclValue::from_kcl_val(obj.get("tag")?);
        let_field_of!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::ExtrudeArc {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, face_id "faceId");
        let tag = FromKclValue::from_kcl_val(obj.get("tag")?);
        let_field_of!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::GeoMeta {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, id);
        let_field_of!(obj, source_range "sourceRange");
        Some(Self {
            id,
            metadata: Metadata { source_range },
        })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::ChamferSurface {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, face_id "faceId");
        let tag = FromKclValue::from_kcl_val(obj.get("tag")?);
        let_field_of!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::FilletSurface {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, face_id "faceId");
        let tag = FromKclValue::from_kcl_val(obj.get("tag")?);
        let_field_of!(obj, geo_meta "geoMeta");
        Some(Self { face_id, tag, geo_meta })
    }
}

impl<'a> FromKclValue<'a> for ExtrudeSurface {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = crate::execution::ExtrudePlane::from_kcl_val;
        let case2 = crate::execution::ExtrudeArc::from_kcl_val;
        let case3 = crate::execution::ChamferSurface::from_kcl_val;
        let case4 = crate::execution::FilletSurface::from_kcl_val;
        case1(arg)
            .map(Self::ExtrudePlane)
            .or_else(|| case2(arg).map(Self::ExtrudeArc))
            .or_else(|| case3(arg).map(Self::Chamfer))
            .or_else(|| case4(arg).map(Self::Fillet))
    }
}

impl<'a> FromKclValue<'a> for crate::execution::EdgeCut {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let obj = arg.as_object()?;
        let_field_of!(obj, typ "type");
        let tag = Box::new(obj.get("tag").and_then(FromKclValue::from_kcl_val));
        let_field_of!(obj, edge_id "edgeId");
        let_field_of!(obj, id);
        match typ {
            "fillet" => {
                let_field_of!(obj, radius);
                Some(Self::Fillet {
                    edge_id,
                    tag,
                    id,
                    radius,
                })
            }
            "chamfer" => {
                let_field_of!(obj, length);
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
            fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
                arg.clone()
                    .into_array()
                    .iter()
                    .map(|value| FromKclValue::from_kcl_val(value))
                    .collect::<Option<_>>()
            }
        }
    };
}

impl_from_kcl_for_vec!(FaceTag);
impl_from_kcl_for_vec!(crate::execution::EdgeCut);
impl_from_kcl_for_vec!(crate::execution::Metadata);
impl_from_kcl_for_vec!(super::fillet::EdgeReference);
impl_from_kcl_for_vec!(ExtrudeSurface);
impl_from_kcl_for_vec!(TyF64);
impl_from_kcl_for_vec!(Solid);
impl_from_kcl_for_vec!(Sketch);

impl<'a> FromKclValue<'a> for SourceRange {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let value = match arg {
            KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => value,
            _ => {
                return None;
            }
        };
        if value.len() != 3 {
            return None;
        }
        let v0 = value.first()?;
        let v1 = value.get(1)?;
        let v2 = value.get(2)?;
        Some(SourceRange::new(
            v0.as_usize()?,
            v1.as_usize()?,
            ModuleId::from_usize(v2.as_usize()?),
        ))
    }
}

impl<'a> FromKclValue<'a> for crate::execution::Metadata {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        FromKclValue::from_kcl_val(arg).map(|sr| Self { source_range: sr })
    }
}

impl<'a> FromKclValue<'a> for crate::execution::Solid {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.as_solid().cloned()
    }
}

impl<'a> FromKclValue<'a> for crate::execution::SolidOrSketchOrImportedGeometry {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Solid { value } => Some(Self::SolidSet(vec![(**value).clone()])),
            KclValue::Sketch { value } => Some(Self::SketchSet(vec![(**value).clone()])),
            KclValue::HomArray { value, .. } => {
                let mut solids = vec![];
                let mut sketches = vec![];
                for item in value {
                    match item {
                        KclValue::Solid { value } => solids.push((**value).clone()),
                        KclValue::Sketch { value } => sketches.push((**value).clone()),
                        _ => return None,
                    }
                }
                if !solids.is_empty() {
                    Some(Self::SolidSet(solids))
                } else {
                    Some(Self::SketchSet(sketches))
                }
            }
            KclValue::ImportedGeometry(value) => Some(Self::ImportedGeometry(Box::new(value.clone()))),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for crate::execution::SolidOrImportedGeometry {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Solid { value } => Some(Self::SolidSet(vec![(**value).clone()])),
            KclValue::HomArray { value, .. } => {
                let mut solids = vec![];
                for item in value {
                    match item {
                        KclValue::Solid { value } => solids.push((**value).clone()),
                        _ => return None,
                    }
                }
                Some(Self::SolidSet(solids))
            }
            KclValue::ImportedGeometry(value) => Some(Self::ImportedGeometry(Box::new(value.clone()))),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for super::sketch::SketchData {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        // Order is critical since PlaneData is a subset of Plane.
        let case1 = crate::execution::Plane::from_kcl_val;
        let case2 = super::sketch::PlaneData::from_kcl_val;
        let case3 = crate::execution::Solid::from_kcl_val;
        let case4 = <Vec<Solid>>::from_kcl_val;
        case1(arg)
            .map(Box::new)
            .map(Self::Plane)
            .or_else(|| case2(arg).map(Self::PlaneOrientation))
            .or_else(|| case3(arg).map(Box::new).map(Self::Solid))
            .or_else(|| case4(arg).map(|v| Box::new(v[0].clone())).map(Self::Solid))
    }
}

impl<'a> FromKclValue<'a> for super::fillet::EdgeReference {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let id = arg.as_uuid().map(Self::Uuid);
        let tag = || TagIdentifier::from_kcl_val(arg).map(Box::new).map(Self::Tag);
        id.or_else(tag)
    }
}

impl<'a> FromKclValue<'a> for super::axis_or_reference::Axis2dOrEdgeReference {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = |arg: &KclValue| {
            let obj = arg.as_object()?;
            let_field_of!(obj, direction);
            let_field_of!(obj, origin);
            Some(Self::Axis { direction, origin })
        };
        let case2 = super::fillet::EdgeReference::from_kcl_val;
        case1(arg).or_else(|| case2(arg).map(Self::Edge))
    }
}

impl<'a> FromKclValue<'a> for super::axis_or_reference::Axis3dOrEdgeReference {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = |arg: &KclValue| {
            let obj = arg.as_object()?;
            let_field_of!(obj, direction);
            let_field_of!(obj, origin);
            Some(Self::Axis { direction, origin })
        };
        let case2 = super::fillet::EdgeReference::from_kcl_val;
        case1(arg).or_else(|| case2(arg).map(Self::Edge))
    }
}

impl<'a> FromKclValue<'a> for super::axis_or_reference::Axis2dOrPoint2d {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = |arg: &KclValue| {
            let obj = arg.as_object()?;
            let_field_of!(obj, direction);
            let_field_of!(obj, origin);
            Some(Self::Axis { direction, origin })
        };
        let case2 = <[TyF64; 2]>::from_kcl_val;
        case1(arg).or_else(|| case2(arg).map(Self::Point))
    }
}

impl<'a> FromKclValue<'a> for super::axis_or_reference::Axis3dOrPoint3d {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = |arg: &KclValue| {
            let obj = arg.as_object()?;
            let_field_of!(obj, direction);
            let_field_of!(obj, origin);
            Some(Self::Axis { direction, origin })
        };
        let case2 = <[TyF64; 3]>::from_kcl_val;
        case1(arg).or_else(|| case2(arg).map(Self::Point))
    }
}

impl<'a> FromKclValue<'a> for i64 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Number { value, .. } => crate::try_f64_to_i64(*value),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for &'a str {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::String { value, meta: _ } = arg else {
            return None;
        };
        Some(value)
    }
}

impl<'a> FromKclValue<'a> for &'a KclObjectFields {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Object { value, meta: _ } = arg else {
            return None;
        };
        Some(value)
    }
}

impl<'a> FromKclValue<'a> for uuid::Uuid {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Uuid { value, meta: _ } = arg else {
            return None;
        };
        Some(*value)
    }
}

impl<'a> FromKclValue<'a> for u32 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Number { value, .. } => crate::try_f64_to_u32(*value),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for NonZeroU32 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        u32::from_kcl_val(arg).and_then(|x| x.try_into().ok())
    }
}

impl<'a> FromKclValue<'a> for u64 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Number { value, .. } => crate::try_f64_to_u64(*value),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for TyF64 {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Number { value, ty, .. } => Some(TyF64::new(*value, *ty)),
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for [TyF64; 2] {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Tuple { value, meta: _ } | KclValue::HomArray { value, .. } => {
                if value.len() != 2 {
                    return None;
                }
                let v0 = value.first()?;
                let v1 = value.get(1)?;
                let array = [v0.as_ty_f64()?, v1.as_ty_f64()?];
                Some(array)
            }
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for [TyF64; 3] {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Tuple { value, meta: _ } | KclValue::HomArray { value, .. } => {
                if value.len() != 3 {
                    return None;
                }
                let v0 = value.first()?;
                let v1 = value.get(1)?;
                let v2 = value.get(2)?;
                let array = [v0.as_ty_f64()?, v1.as_ty_f64()?, v2.as_ty_f64()?];
                Some(array)
            }
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for [TyF64; 6] {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Tuple { value, meta: _ } | KclValue::HomArray { value, .. } => {
                if value.len() != 6 {
                    return None;
                }
                let v0 = value.first()?;
                let v1 = value.get(1)?;
                let v2 = value.get(2)?;
                let v3 = value.get(3)?;
                let v4 = value.get(4)?;
                let v5 = value.get(5)?;
                let array = [
                    v0.as_ty_f64()?,
                    v1.as_ty_f64()?,
                    v2.as_ty_f64()?,
                    v3.as_ty_f64()?,
                    v4.as_ty_f64()?,
                    v5.as_ty_f64()?,
                ];
                Some(array)
            }
            _ => None,
        }
    }
}

impl<'a> FromKclValue<'a> for Sketch {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Sketch { value } = arg else {
            return None;
        };
        Some(value.as_ref().to_owned())
    }
}

impl<'a> FromKclValue<'a> for Helix {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Helix { value } = arg else {
            return None;
        };
        Some(value.as_ref().to_owned())
    }
}

impl<'a> FromKclValue<'a> for SweepPath {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let case1 = Sketch::from_kcl_val;
        let case2 = <Vec<Sketch>>::from_kcl_val;
        let case3 = Helix::from_kcl_val;
        case1(arg)
            .map(Self::Sketch)
            .or_else(|| case2(arg).map(|arg0: Vec<Sketch>| Self::Sketch(arg0[0].clone())))
            .or_else(|| case3(arg).map(|arg0: Helix| Self::Helix(Box::new(arg0))))
    }
}
impl<'a> FromKclValue<'a> for String {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::String { value, meta: _ } = arg else {
            return None;
        };
        Some(value.to_owned())
    }
}
impl<'a> FromKclValue<'a> for crate::parsing::ast::types::KclNone {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::KclNone { value, meta: _ } = arg else {
            return None;
        };
        Some(value.to_owned())
    }
}
impl<'a> FromKclValue<'a> for bool {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Bool { value, meta: _ } = arg else {
            return None;
        };
        Some(*value)
    }
}

impl<'a> FromKclValue<'a> for Box<Solid> {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        let KclValue::Solid { value } = arg else {
            return None;
        };
        Some(value.to_owned())
    }
}

impl<'a> FromKclValue<'a> for FunctionSource {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        arg.as_function().cloned()
    }
}

impl<'a> FromKclValue<'a> for SketchOrSurface {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Sketch { value: sg } => Some(Self::Sketch(sg.to_owned())),
            KclValue::Plane { value } => Some(Self::SketchSurface(SketchSurface::Plane(value.clone()))),
            KclValue::Face { value } => Some(Self::SketchSurface(SketchSurface::Face(value.clone()))),
            _ => None,
        }
    }
}
impl<'a> FromKclValue<'a> for SketchSurface {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Plane { value } => Some(Self::Plane(value.clone())),
            KclValue::Face { value } => Some(Self::Face(value.clone())),
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
