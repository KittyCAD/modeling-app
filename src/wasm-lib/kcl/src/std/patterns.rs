//! Standard library patterns.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{
        ExtrudeGroup, ExtrudeGroupSet, Geometries, Geometry, MemoryItem, Point3d, ProgramReturn, SketchGroup,
        SketchGroupSet, SourceRange, UserVal,
    },
    function_param::FunctionParam,
    std::{types::Uint, Args},
};

/// Data for a linear pattern on a 2D sketch.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LinearPattern2dData {
    /// The number of repetitions. Must be greater than 0.
    /// This excludes the original entity. For example, if `repetitions` is 1,
    /// the original entity will be copied once.
    pub repetitions: Uint,
    /// The distance between each repetition. This can also be referred to as spacing.
    pub distance: f64,
    /// The axis of the pattern. This is a 2D vector.
    pub axis: [f64; 2],
}

/// Data for a linear pattern on a 3D model.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LinearPattern3dData {
    /// The number of repetitions. Must be greater than 0.
    /// This excludes the original entity. For example, if `repetitions` is 1,
    /// the original entity will be copied once.
    pub repetitions: Uint,
    /// The distance between each repetition. This can also be referred to as spacing.
    pub distance: f64,
    /// The axis of the pattern.
    pub axis: [f64; 3],
}

pub enum LinearPattern {
    ThreeD(LinearPattern3dData),
    TwoD(LinearPattern2dData),
}

impl LinearPattern {
    pub fn axis(&self) -> [f64; 3] {
        match self {
            LinearPattern::TwoD(lp) => [lp.axis[0], lp.axis[1], 0.0],
            LinearPattern::ThreeD(lp) => lp.axis,
        }
    }

    pub fn repetitions(&self) -> u32 {
        match self {
            LinearPattern::TwoD(lp) => lp.repetitions.u32(),
            LinearPattern::ThreeD(lp) => lp.repetitions.u32(),
        }
    }

    pub fn distance(&self) -> f64 {
        match self {
            LinearPattern::TwoD(lp) => lp.distance,
            LinearPattern::ThreeD(lp) => lp.distance,
        }
    }
}

/// A linear pattern
/// Each element in the pattern repeats a particular piece of geometry.
/// The repetitions can be transformed by the `transform` parameter.
pub async fn pattern_transform(args: Args) -> Result<MemoryItem, KclError> {
    let (num_repetitions, transform, extr) = args.get_pattern_transform_args()?;

    let extrude_groups = inner_pattern_transform(
        num_repetitions,
        FunctionParam {
            inner: transform.func,
            fn_expr: transform.expr,
            meta: vec![args.source_range.into()],
            ctx: args.ctx.clone(),
            memory: args.current_program_memory.clone(),
        },
        extr,
        &args,
    )
    .await?;
    Ok(MemoryItem::ExtrudeGroups { value: extrude_groups })
}

/// A linear pattern on a 3D solid.
/// Each repetition of the pattern can be transformed (e.g. scaled, translated, hidden, etc).
///
/// ```no_run
/// // Parameters
/// const r = 50    // base radius
/// const h = 10    // layer height
/// const t = 0.005 // taper factor [0-1)
/// // Defines how to modify each layer of the vase.
/// // Each replica is shifted up the Z axis, and has a smoothly-varying radius
/// fn transform = (replicaId) => {
///   let scale = r * abs(1 - (t * replicaId)) * (5 + cos(replicaId / 8))
///   return {
///     translate: [0, 0, replicaId * 10],
///     scale: [scale, scale, 0],
///   }
/// }
/// // Each layer is just a pretty thin cylinder with a fillet.
/// fn layer = () => {
///   return startSketchOn("XY") // or some other plane idk
///     |> circle([0, 0], 1, %, 'tag1')
///     |> extrude(h, %)
///     // |> fillet({
///     //        radius: h / 2.01,
///     //        tags: ["tag1", getOppositeEdge("tag1", %)]
///     //    }, %)
/// }
/// // The vase is 100 layers tall.
/// // The 100 layers are replica of each other, with a slight transformation applied to each.
/// let vase = layer() |> patternTransform(100, transform, %)
/// ```
#[stdlib {
     name = "patternTransform",
 }]
async fn inner_pattern_transform<'a>(
    num_repetitions: u32,
    transform_function: FunctionParam<'a>,
    extrude_group_set: ExtrudeGroupSet,
    args: &'a Args,
) -> Result<Vec<Box<ExtrudeGroup>>, KclError> {
    // Build the vec of transforms, one for each repetition.
    let mut transform = Vec::new();
    for i in 0..num_repetitions {
        let t = make_transform(i, &transform_function, args.source_range).await?;
        transform.push(t);
    }
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not flush these, then you won't be able to pattern something with fillets.
    // Flush just the fillets/chamfers that apply to these extrude groups.
    args.flush_batch_for_extrude_group_set(extrude_group_set.clone().into())
        .await?;

    let starting_extrude_groups: Vec<Box<ExtrudeGroup>> = extrude_group_set.into();

    if args.ctx.is_mock {
        return Ok(starting_extrude_groups);
    }

    let mut extrude_groups = Vec::new();
    for e in starting_extrude_groups {
        let new_extrude_groups = send_pattern_transform(transform.clone(), &e, args).await?;
        extrude_groups.extend(new_extrude_groups);
    }
    Ok(extrude_groups)
}

async fn send_pattern_transform(
    // This should be passed via reference, see
    // https://github.com/KittyCAD/modeling-app/issues/2821
    transform: Vec<kittycad::types::LinearTransform>,
    extrude_group: &ExtrudeGroup,
    args: &Args,
) -> Result<Vec<Box<ExtrudeGroup>>, KclError> {
    let id = uuid::Uuid::new_v4();

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::EntityLinearPatternTransform {
                entity_id: extrude_group.id,
                transform,
            },
        )
        .await?;

    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::EntityLinearPatternTransform { data: pattern_info },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityLinearPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let mut geometries = vec![Box::new(extrude_group.clone())];
    for id in pattern_info.entity_ids.iter() {
        let mut new_extrude_group = extrude_group.clone();
        new_extrude_group.id = *id;
        geometries.push(Box::new(new_extrude_group));
    }
    Ok(geometries)
}

async fn make_transform<'a>(
    i: u32,
    transform_function: &FunctionParam<'a>,
    source_range: SourceRange,
) -> Result<kittycad::types::LinearTransform, KclError> {
    // Call the transform fn for this repetition.
    let repetition_num = MemoryItem::UserVal(UserVal {
        value: serde_json::Value::Number(i.into()),
        meta: vec![source_range.into()],
    });
    let transform_fn_args = vec![repetition_num];
    let transform_fn_return = transform_function.call(transform_fn_args).await?.0;

    // Unpack the returned transform object.
    let source_ranges = vec![source_range];
    let transform_fn_return = transform_fn_return.ok_or_else(|| {
        KclError::Semantic(KclErrorDetails {
            message: "Transform function must return a value".to_string(),
            source_ranges: source_ranges.clone(),
        })
    })?;
    let ProgramReturn::Value(transform_fn_return) = transform_fn_return else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Transform function must return a value".to_string(),
            source_ranges: source_ranges.clone(),
        }));
    };
    let MemoryItem::UserVal(transform) = transform_fn_return else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Transform function must return a transform object".to_string(),
            source_ranges: source_ranges.clone(),
        }));
    };

    // Apply defaults to the transform.
    let replicate = match transform.value.get("replicate") {
        Some(serde_json::Value::Bool(true)) => true,
        Some(serde_json::Value::Bool(false)) => false,
        Some(_) => {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "The 'replicate' key must be a bool".to_string(),
                source_ranges: source_ranges.clone(),
            }));
        }
        None => true,
    };
    let scale = match transform.value.get("scale") {
        Some(x) => array_to_point3d(x, source_ranges.clone())?,
        None => Point3d { x: 1.0, y: 1.0, z: 1.0 },
    };
    let translate = match transform.value.get("translate") {
        Some(x) => array_to_point3d(x, source_ranges.clone())?,
        None => Point3d { x: 0.0, y: 0.0, z: 0.0 },
    };
    let t = kittycad::types::LinearTransform {
        replicate,
        scale: Some(scale.into()),
        translate: Some(translate.into()),
    };
    Ok(t)
}

fn array_to_point3d(json: &serde_json::Value, source_ranges: Vec<SourceRange>) -> Result<Point3d, KclError> {
    let serde_json::Value::Array(arr) = dbg!(json) else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Expected an array of 3 numbers (i.e. a 3D point)".to_string(),
            source_ranges,
        }));
    };
    let len = arr.len();
    if len != 3 {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!("Expected an array of 3 numbers (i.e. a 3D point) but found {len} items"),
            source_ranges,
        }));
    };
    // Gets an f64 from a JSON value, returns Option.
    let f = |j: &serde_json::Value| j.as_number().and_then(|num| num.as_f64()).map(|x| x.to_owned());
    let err = |component| {
        KclError::Semantic(KclErrorDetails {
            message: format!("{component} component of this point was not a number"),
            source_ranges: source_ranges.clone(),
        })
    };
    let x = f(&arr[0]).ok_or_else(|| err("X"))?;
    let y = f(&arr[1]).ok_or_else(|| err("Y"))?;
    let z = f(&arr[2]).ok_or_else(|| err("Z"))?;
    Ok(Point3d { x, y, z })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_array_to_point3d() {
        let input = serde_json::json! {
            [1.1, 2.2, 3.3]
        };
        let expected = Point3d { x: 1.1, y: 2.2, z: 3.3 };
        let actual = array_to_point3d(&input, Vec::new());
        assert_eq!(actual.unwrap(), expected);
    }
}

/// A linear pattern on a 2D sketch.
pub async fn pattern_linear_2d(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group_set): (LinearPattern2dData, SketchGroupSet) = args.get_data_and_sketch_group_set()?;

    if data.axis == [0.0, 0.0] {
        return Err(KclError::Semantic(KclErrorDetails {
            message:
                "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                    .to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let sketch_groups = inner_pattern_linear_2d(data, sketch_group_set, args).await?;
    Ok(sketch_groups.into())
}

/// A linear pattern on a 2D sketch.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> circle([0, 0], 1, %)
///   |> patternLinear2d({
///        axis: [1, 0],
///        repetitions: 6,
///        distance: 4
///      }, %)
///
/// const example = extrude(1, exampleSketch)
/// ```
#[stdlib {
    name = "patternLinear2d",
}]
async fn inner_pattern_linear_2d(
    data: LinearPattern2dData,
    sketch_group_set: SketchGroupSet,
    args: Args,
) -> Result<Vec<Box<SketchGroup>>, KclError> {
    let starting_sketch_groups: Vec<Box<SketchGroup>> = sketch_group_set.into();

    if args.ctx.is_mock {
        return Ok(starting_sketch_groups);
    }

    let mut sketch_groups = Vec::new();
    for sketch_group in starting_sketch_groups.iter() {
        let geometries = pattern_linear(
            LinearPattern::TwoD(data.clone()),
            Geometry::SketchGroup(sketch_group.clone()),
            args.clone(),
        )
        .await?;

        let Geometries::SketchGroups(new_sketch_groups) = geometries else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected a vec of sketch groups".to_string(),
                source_ranges: vec![args.source_range],
            }));
        };

        sketch_groups.extend(new_sketch_groups);
    }

    Ok(sketch_groups)
}

/// A linear pattern on a 3D model.
pub async fn pattern_linear_3d(args: Args) -> Result<MemoryItem, KclError> {
    let (data, extrude_group_set): (LinearPattern3dData, ExtrudeGroupSet) = args.get_data_and_extrude_group_set()?;

    if data.axis == [0.0, 0.0, 0.0] {
        return Err(KclError::Semantic(KclErrorDetails {
            message:
                "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                    .to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let extrude_groups = inner_pattern_linear_3d(data, extrude_group_set, args).await?;
    Ok(extrude_groups.into())
}

/// A linear pattern on a 3D model.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([0, 2], %)
///   |> line([3, 1], %)
///   |> line([0, -4], %)
///   |> close(%)
///
/// const example = extrude(1, exampleSketch)
///   |> patternLinear3d({
///        axis: [1, 0, 1],
///        repetitions: 6,
///       distance: 6
///     }, %)
/// ```
#[stdlib {
    name = "patternLinear3d",
}]
async fn inner_pattern_linear_3d(
    data: LinearPattern3dData,
    extrude_group_set: ExtrudeGroupSet,
    args: Args,
) -> Result<Vec<Box<ExtrudeGroup>>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not flush these, then you won't be able to pattern something with fillets.
    // Flush just the fillets/chamfers that apply to these extrude groups.
    args.flush_batch_for_extrude_group_set(extrude_group_set.clone().into())
        .await?;

    let starting_extrude_groups: Vec<Box<ExtrudeGroup>> = extrude_group_set.into();

    if args.ctx.is_mock {
        return Ok(starting_extrude_groups);
    }

    let mut extrude_groups = Vec::new();
    for extrude_group in starting_extrude_groups.iter() {
        let geometries = pattern_linear(
            LinearPattern::ThreeD(data.clone()),
            Geometry::ExtrudeGroup(extrude_group.clone()),
            args.clone(),
        )
        .await?;

        let Geometries::ExtrudeGroups(new_extrude_groups) = geometries else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected a vec of extrude groups".to_string(),
                source_ranges: vec![args.source_range],
            }));
        };

        extrude_groups.extend(new_extrude_groups);
    }

    Ok(extrude_groups)
}

async fn pattern_linear(data: LinearPattern, geometry: Geometry, args: Args) -> Result<Geometries, KclError> {
    let id = uuid::Uuid::new_v4();

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::EntityLinearPattern {
                axis: kittycad::types::Point3D {
                    x: data.axis()[0],
                    y: data.axis()[1],
                    z: data.axis()[2],
                },
                entity_id: geometry.id(),
                num_repetitions: data.repetitions(),
                spacing: data.distance(),
            },
        )
        .await?;

    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::EntityLinearPattern { data: pattern_info },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityLinearPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let geometries = match geometry {
        Geometry::SketchGroup(sketch_group) => {
            let mut geometries = vec![sketch_group.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_sketch_group = sketch_group.clone();
                new_sketch_group.id = *id;
                geometries.push(new_sketch_group);
            }
            Geometries::SketchGroups(geometries)
        }
        Geometry::ExtrudeGroup(extrude_group) => {
            let mut geometries = vec![extrude_group.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_extrude_group = extrude_group.clone();
                new_extrude_group.id = *id;
                geometries.push(new_extrude_group);
            }
            Geometries::ExtrudeGroups(geometries)
        }
    };

    Ok(geometries)
}

/// Data for a circular pattern on a 2D sketch.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CircularPattern2dData {
    /// The number of repetitions. Must be greater than 0.
    /// This excludes the original entity. For example, if `repetitions` is 1,
    /// the original entity will be copied once.
    pub repetitions: Uint,
    /// The center about which to make the pattern. This is a 2D vector.
    pub center: [f64; 2],
    /// The arc angle (in degrees) to place the repetitions. Must be greater than 0.
    pub arc_degrees: f64,
    /// Whether or not to rotate the duplicates as they are copied.
    pub rotate_duplicates: bool,
}

/// Data for a circular pattern on a 3D model.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CircularPattern3dData {
    /// The number of repetitions. Must be greater than 0.
    /// This excludes the original entity. For example, if `repetitions` is 1,
    /// the original entity will be copied once.
    pub repetitions: Uint,
    /// The axis around which to make the pattern. This is a 3D vector.
    pub axis: [f64; 3],
    /// The center about which to make the pattern. This is a 3D vector.
    pub center: [f64; 3],
    /// The arc angle (in degrees) to place the repetitions. Must be greater than 0.
    pub arc_degrees: f64,
    /// Whether or not to rotate the duplicates as they are copied.
    pub rotate_duplicates: bool,
}

pub enum CircularPattern {
    ThreeD(CircularPattern3dData),
    TwoD(CircularPattern2dData),
}

impl CircularPattern {
    pub fn axis(&self) -> [f64; 3] {
        match self {
            CircularPattern::TwoD(_lp) => [0.0, 0.0, 0.0],
            CircularPattern::ThreeD(lp) => lp.axis,
        }
    }

    pub fn center(&self) -> [f64; 3] {
        match self {
            CircularPattern::TwoD(lp) => [lp.center[0], lp.center[1], 0.0],
            CircularPattern::ThreeD(lp) => lp.center,
        }
    }

    pub fn repetitions(&self) -> u32 {
        match self {
            CircularPattern::TwoD(lp) => lp.repetitions.u32(),
            CircularPattern::ThreeD(lp) => lp.repetitions.u32(),
        }
    }

    pub fn arc_degrees(&self) -> f64 {
        match self {
            CircularPattern::TwoD(lp) => lp.arc_degrees,
            CircularPattern::ThreeD(lp) => lp.arc_degrees,
        }
    }

    pub fn rotate_duplicates(&self) -> bool {
        match self {
            CircularPattern::TwoD(lp) => lp.rotate_duplicates,
            CircularPattern::ThreeD(lp) => lp.rotate_duplicates,
        }
    }
}

/// A circular pattern on a 2D sketch.
pub async fn pattern_circular_2d(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group_set): (CircularPattern2dData, SketchGroupSet) = args.get_data_and_sketch_group_set()?;

    let sketch_groups = inner_pattern_circular_2d(data, sketch_group_set, args).await?;
    Ok(sketch_groups.into())
}

/// A circular pattern on a 2D sketch.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([.5, 25], %)
///   |> line([0, 5], %)
///   |> line([-1, 0], %)
///   |> line([0, -5], %)
///   |> close(%)
///   |> patternCircular2d({
///        center: [0, 0],
///        repetitions: 12,
///        arcDegrees: 360,
///        rotateDuplicates: true
///      }, %)
///
/// const example = extrude(1, exampleSketch)
/// ```
#[stdlib {
    name = "patternCircular2d",
}]
async fn inner_pattern_circular_2d(
    data: CircularPattern2dData,
    sketch_group_set: SketchGroupSet,
    args: Args,
) -> Result<Vec<Box<SketchGroup>>, KclError> {
    let starting_sketch_groups: Vec<Box<SketchGroup>> = sketch_group_set.into();

    if args.ctx.is_mock {
        return Ok(starting_sketch_groups);
    }

    let mut sketch_groups = Vec::new();
    for sketch_group in starting_sketch_groups.iter() {
        let geometries = pattern_circular(
            CircularPattern::TwoD(data.clone()),
            Geometry::SketchGroup(sketch_group.clone()),
            args.clone(),
        )
        .await?;

        let Geometries::SketchGroups(new_sketch_groups) = geometries else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected a vec of sketch groups".to_string(),
                source_ranges: vec![args.source_range],
            }));
        };

        sketch_groups.extend(new_sketch_groups);
    }

    Ok(sketch_groups)
}

/// A circular pattern on a 3D model.
pub async fn pattern_circular_3d(args: Args) -> Result<MemoryItem, KclError> {
    let (data, extrude_group_set): (CircularPattern3dData, ExtrudeGroupSet) = args.get_data_and_extrude_group_set()?;

    let extrude_groups = inner_pattern_circular_3d(data, extrude_group_set, args).await?;
    Ok(extrude_groups.into())
}

/// A circular pattern on a 3D model.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> circle([0, 0], 1, %)
///
/// const example = extrude(-5, exampleSketch)
///   |> patternCircular3d({
///        axis: [1, -1, 0],
///        center: [10, -20, 0],
///        repetitions: 10,
///        arcDegrees: 360,
///        rotateDuplicates: true
///      }, %)
/// ```
#[stdlib {
    name = "patternCircular3d",
}]
async fn inner_pattern_circular_3d(
    data: CircularPattern3dData,
    extrude_group_set: ExtrudeGroupSet,
    args: Args,
) -> Result<Vec<Box<ExtrudeGroup>>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not flush these, then you won't be able to pattern something with fillets.
    // Flush just the fillets/chamfers that apply to these extrude groups.
    args.flush_batch_for_extrude_group_set(extrude_group_set.clone().into())
        .await?;

    let starting_extrude_groups: Vec<Box<ExtrudeGroup>> = extrude_group_set.into();

    if args.ctx.is_mock {
        return Ok(starting_extrude_groups);
    }

    let mut extrude_groups = Vec::new();
    for extrude_group in starting_extrude_groups.iter() {
        let geometries = pattern_circular(
            CircularPattern::ThreeD(data.clone()),
            Geometry::ExtrudeGroup(extrude_group.clone()),
            args.clone(),
        )
        .await?;

        let Geometries::ExtrudeGroups(new_extrude_groups) = geometries else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected a vec of extrude groups".to_string(),
                source_ranges: vec![args.source_range],
            }));
        };

        extrude_groups.extend(new_extrude_groups);
    }

    Ok(extrude_groups)
}

async fn pattern_circular(data: CircularPattern, geometry: Geometry, args: Args) -> Result<Geometries, KclError> {
    let id = uuid::Uuid::new_v4();

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::EntityCircularPattern {
                axis: kittycad::types::Point3D {
                    x: data.axis()[0],
                    y: data.axis()[1],
                    z: data.axis()[2],
                },
                entity_id: geometry.id(),
                center: data.center().into(),
                num_repetitions: data.repetitions(),
                arc_degrees: data.arc_degrees(),
                rotate_duplicates: data.rotate_duplicates(),
            },
        )
        .await?;

    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::EntityCircularPattern { data: pattern_info },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityCircularPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let geometries = match geometry {
        Geometry::SketchGroup(sketch_group) => {
            let mut geometries = vec![sketch_group.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_sketch_group = sketch_group.clone();
                new_sketch_group.id = *id;
                geometries.push(new_sketch_group);
            }
            Geometries::SketchGroups(geometries)
        }
        Geometry::ExtrudeGroup(extrude_group) => {
            let mut geometries = vec![extrude_group.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_extrude_group = extrude_group.clone();
                new_extrude_group.id = *id;
                geometries.push(new_extrude_group);
            }
            Geometries::ExtrudeGroups(geometries)
        }
    };

    Ok(geometries)
}
