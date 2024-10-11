//! Standard library patterns.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{
    each_cmd as mcmd, length_unit::LengthUnit, ok_response::OkModelingCmdResponse, shared::Transform,
    websocket::OkWebSocketResponseData, ModelingCmd,
};
use kittycad_modeling_cmds::{
    self as kcmc,
    shared::{Angle, OriginType, Rotation},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value as JValue;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{
        ExecState, Geometries, Geometry, KclValue, Point3d, Sketch, SketchSet, Solid, SolidSet, SourceRange, UserVal,
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
pub async fn pattern_transform(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (num_repetitions, transform, extr) = args.get_pattern_transform_args()?;

    let solids = inner_pattern_transform(
        num_repetitions,
        FunctionParam {
            inner: transform.func,
            fn_expr: transform.expr,
            meta: vec![args.source_range.into()],
            ctx: args.ctx.clone(),
            memory: *transform.memory,
        },
        extr,
        exec_state,
        &args,
    )
    .await?;
    Ok(KclValue::Solids { value: solids })
}

/// Repeat a 3-dimensional solid, changing it each time.
///
/// Replicates the 3D solid, applying a transformation function to each replica.
/// Transformation function could alter rotation, scale, visibility, position, etc.
///
/// The `patternTransform` call itself takes a number for how many total instances of
/// the shape should be. For example, if you use a circle with `patternTransform(4, transform)`
/// then there will be 4 circles: the original, and 3 created by replicating the original and
/// calling the transform function on each.
///
/// The transform function takes a single parameter: an integer representing which
/// number replication the transform is for. E.g. the first replica to be transformed
/// will be passed the argument `1`. This simplifies your math: the transform function can
/// rely on id `0` being the original instance passed into the `patternTransform`. See the examples.
///
/// The transform function returns a transform object. All properties of the object are optional,
/// they each default to "no change". So the overall transform object defaults to "no change" too.
/// Its properties are:
///
///  - `translate` (3D point)
///
///    Translates the replica, moving its position in space.      
///
///  - `replicate` (bool)
///
///    If false, this ID will not actually copy the object. It'll be skipped.
///
///  - `scale` (3D point)
///
///    Stretches the object, multiplying its width in the given dimension by the point's component in
///    that direction.      
///
///  - `rotation` (object, with the following properties)
///
///    - `rotation.axis` (a 3D point, defaults to the Z axis)
///
///    - `rotation.angle` (number of degrees)
///
///    - `rotation.origin` (either "local" i.e. rotate around its own center, "global" i.e. rotate around the scene's center, or a 3D point, defaults to "local")
///
/// ```no_run
/// // Each instance will be shifted along the X axis.
/// fn transform = (id) => {
///   return { translate: [4 * id, 0, 0] }
/// }
///
/// // Sketch 4 cylinders.
/// const sketch001 = startSketchOn('XZ')
///   |> circle({ center: [0, 0], radius: 2 }, %)
///   |> extrude(5, %)
///   |> patternTransform(4, transform, %)
/// ```
/// ```no_run
/// // Each instance will be shifted along the X axis,
/// // with a gap between the original (at x = 0) and the first replica
/// // (at x = 8). This is because `id` starts at 1.
/// fn transform = (id) => {
///   return { translate: [4 * (1+id), 0, 0] }
/// }
///
/// const sketch001 = startSketchOn('XZ')
///   |> circle({ center: [0, 0], radius: 2 }, %)
///   |> extrude(5, %)
///   |> patternTransform(4, transform, %)
/// ```
/// ```no_run
/// fn cube = (length, center) => {
///   let l = length/2
///   let x = center[0]
///   let y = center[1]
///   let p0 = [-l + x, -l + y]
///   let p1 = [-l + x,  l + y]
///   let p2 = [ l + x,  l + y]
///   let p3 = [ l + x, -l + y]
///
///   return startSketchAt(p0)
///   |> lineTo(p1, %)
///   |> lineTo(p2, %)
///   |> lineTo(p3, %)
///   |> lineTo(p0, %)
///   |> close(%)
///   |> extrude(length, %)
/// }
///
/// let width = 20
/// fn transform = (i) => {
///   return {
///     // Move down each time.
///     translate: [0, 0, -i * width],
///     // Make the cube longer, wider and flatter each time.
///     scale: [pow(1.1, i), pow(1.1, i), pow(0.9, i)],
///     // Turn by 15 degrees each time.
///     rotation: {
///       angle: 15 * i,
///       origin: "local",
///     }
///   }
/// }
///
/// let myCubes =
///   cube(width, [100,0])
///   |> patternTransform(25, transform, %)
/// ```
///
/// ```no_run
/// fn cube = (length, center) => {
///   let l = length/2
///   let x = center[0]
///   let y = center[1]
///   let p0 = [-l + x, -l + y]
///   let p1 = [-l + x,  l + y]
///   let p2 = [ l + x,  l + y]
///   let p3 = [ l + x, -l + y]
///   
///   return startSketchAt(p0)
///   |> lineTo(p1, %)
///   |> lineTo(p2, %)
///   |> lineTo(p3, %)
///   |> lineTo(p0, %)
///   |> close(%)
///   |> extrude(length, %)
/// }
///
/// let width = 20
/// fn transform = (i) => {
///   return {
///     translate: [0, 0, -i * width],
///     rotation: {
///       angle: 90 * i,
///       // Rotate around the overall scene's origin.
///       origin: "global",
///     }
///   }
/// }
/// let myCubes =
///   cube(width, [100,100])
///   |> patternTransform(4, transform, %)
/// ```
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
/// // Each layer is just a pretty thin cylinder.
/// fn layer = () => {
///   return startSketchOn("XY") // or some other plane idk
///     |> circle({ center: [0, 0], radius: 1 }, %, $tag1)
///     |> extrude(h, %)
/// }
/// // The vase is 100 layers tall.
/// // The 100 layers are replica of each other, with a slight transformation applied to each.
/// let vase = layer() |> patternTransform(100, transform, %)
/// ```
#[stdlib {
     name = "patternTransform",
 }]
async fn inner_pattern_transform<'a>(
    total_instances: u32,
    transform_function: FunctionParam<'a>,
    solid_set: SolidSet,
    exec_state: &mut ExecState,
    args: &'a Args,
) -> Result<Vec<Box<Solid>>, KclError> {
    // Build the vec of transforms, one for each repetition.
    let mut transform = Vec::with_capacity(usize::try_from(total_instances).unwrap());
    for i in 1..total_instances {
        let t = make_transform(i, &transform_function, args.source_range, exec_state).await?;
        transform.push(t);
    }
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not flush these, then you won't be able to pattern something with fillets.
    // Flush just the fillets/chamfers that apply to these solids.
    args.flush_batch_for_solid_set(exec_state, solid_set.clone().into())
        .await?;

    let starting_solids: Vec<Box<Solid>> = solid_set.into();

    if args.ctx.context_type == crate::executor::ContextType::Mock {
        return Ok(starting_solids);
    }

    let mut solids = Vec::new();
    for e in starting_solids {
        let new_solids = send_pattern_transform(transform.clone(), &e, exec_state, args).await?;
        solids.extend(new_solids);
    }
    Ok(solids)
}

async fn send_pattern_transform(
    // This should be passed via reference, see
    // https://github.com/KittyCAD/modeling-app/issues/2821
    transform: Vec<Transform>,
    solid: &Solid,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<Box<Solid>>, KclError> {
    let id = exec_state.id_generator.next_uuid();

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::EntityLinearPatternTransform {
                entity_id: solid.id,
                transform,
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityLinearPatternTransform(pattern_info),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityLinearPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let mut geometries = vec![Box::new(solid.clone())];
    for id in pattern_info.entity_ids.iter() {
        let mut new_solid = solid.clone();
        new_solid.id = *id;
        geometries.push(Box::new(new_solid));
    }
    Ok(geometries)
}

async fn make_transform<'a>(
    i: u32,
    transform_function: &FunctionParam<'a>,
    source_range: SourceRange,
    exec_state: &mut ExecState,
) -> Result<Transform, KclError> {
    // Call the transform fn for this repetition.
    let repetition_num = KclValue::UserVal(UserVal {
        value: JValue::Number(i.into()),
        meta: vec![source_range.into()],
    });
    let transform_fn_args = vec![repetition_num];
    let transform_fn_return = transform_function.call(exec_state, transform_fn_args).await?;

    // Unpack the returned transform object.
    let source_ranges = vec![source_range];
    let transform_fn_return = transform_fn_return.ok_or_else(|| {
        KclError::Semantic(KclErrorDetails {
            message: "Transform function must return a value".to_string(),
            source_ranges: source_ranges.clone(),
        })
    })?;
    let KclValue::UserVal(transform) = transform_fn_return else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Transform function must return a transform object".to_string(),
            source_ranges: source_ranges.clone(),
        }));
    };

    // Apply defaults to the transform.
    let replicate = match transform.value.get("replicate") {
        Some(JValue::Bool(true)) => true,
        Some(JValue::Bool(false)) => false,
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
    let mut rotation = Rotation::default();
    if let Some(rot) = transform.value.get("rotation") {
        if let Some(axis) = rot.get("axis") {
            rotation.axis = array_to_point3d(axis, source_ranges.clone())?.into();
        }
        if let Some(angle) = rot.get("angle") {
            match angle {
                JValue::Number(number) => {
                    if let Some(number) = number.as_f64() {
                        rotation.angle = Angle::from_degrees(number);
                    }
                }
                _ => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: "The 'rotation.angle' key must be a number (of degrees)".to_string(),
                        source_ranges: source_ranges.clone(),
                    }));
                }
            }
        }
        if let Some(origin) = rot.get("origin") {
            rotation.origin = match origin {
                JValue::String(s) if s == "local" => OriginType::Local,
                JValue::String(s) if s == "global" => OriginType::Global,
                other => {
                    let origin = array_to_point3d(other, source_ranges.clone())?.into();
                    OriginType::Custom { origin }
                }
            };
        }
    }
    let t = Transform {
        replicate,
        scale: scale.into(),
        translate: translate.into(),
        rotation,
    };
    Ok(t)
}

fn array_to_point3d(json: &JValue, source_ranges: Vec<SourceRange>) -> Result<Point3d, KclError> {
    let JValue::Array(arr) = json else {
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
    let f = |j: &JValue| j.as_number().and_then(|num| num.as_f64()).map(|x| x.to_owned());
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
pub async fn pattern_linear_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch_set): (LinearPattern2dData, SketchSet) = args.get_data_and_sketch_set()?;

    if data.axis == [0.0, 0.0] {
        return Err(KclError::Semantic(KclErrorDetails {
            message:
                "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                    .to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let sketches = inner_pattern_linear_2d(data, sketch_set, exec_state, args).await?;
    Ok(sketches.into())
}

/// Repeat a 2-dimensional sketch along some dimension, with a dynamic amount
/// of distance between each repetition, some specified number of times.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> circle({ center: [0, 0], radius: 1 }, %)
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
    sketch_set: SketchSet,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Box<Sketch>>, KclError> {
    let starting_sketches: Vec<Box<Sketch>> = sketch_set.into();

    if args.ctx.context_type == crate::executor::ContextType::Mock {
        return Ok(starting_sketches);
    }

    let mut sketches = Vec::new();
    for sketch in starting_sketches.iter() {
        let geometries = pattern_linear(
            LinearPattern::TwoD(data.clone()),
            Geometry::Sketch(sketch.clone()),
            exec_state,
            args.clone(),
        )
        .await?;

        let Geometries::Sketches(new_sketches) = geometries else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected a vec of sketches".to_string(),
                source_ranges: vec![args.source_range],
            }));
        };

        sketches.extend(new_sketches);
    }

    Ok(sketches)
}

/// A linear pattern on a 3D model.
pub async fn pattern_linear_3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid_set): (LinearPattern3dData, SolidSet) = args.get_data_and_solid_set()?;

    if data.axis == [0.0, 0.0, 0.0] {
        return Err(KclError::Semantic(KclErrorDetails {
            message:
                "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                    .to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let solids = inner_pattern_linear_3d(data, solid_set, exec_state, args).await?;
    Ok(solids.into())
}

/// Repeat a 3-dimensional solid along a linear path, with a dynamic amount
/// of distance between each repetition, some specified number of times.
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
    solid_set: SolidSet,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Box<Solid>>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not flush these, then you won't be able to pattern something with fillets.
    // Flush just the fillets/chamfers that apply to these solids.
    args.flush_batch_for_solid_set(exec_state, solid_set.clone().into())
        .await?;

    let starting_solids: Vec<Box<Solid>> = solid_set.into();

    if args.ctx.context_type == crate::executor::ContextType::Mock {
        return Ok(starting_solids);
    }

    let mut solids = Vec::new();
    for solid in starting_solids.iter() {
        let geometries = pattern_linear(
            LinearPattern::ThreeD(data.clone()),
            Geometry::Solid(solid.clone()),
            exec_state,
            args.clone(),
        )
        .await?;

        let Geometries::Solids(new_solids) = geometries else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected a vec of solids".to_string(),
                source_ranges: vec![args.source_range],
            }));
        };

        solids.extend(new_solids);
    }

    Ok(solids)
}

async fn pattern_linear(
    data: LinearPattern,
    geometry: Geometry,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Geometries, KclError> {
    let id = exec_state.id_generator.next_uuid();

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::EntityLinearPattern {
                axis: kcmc::shared::Point3d::from(data.axis()),
                entity_id: geometry.id(),
                num_repetitions: data.repetitions(),
                spacing: LengthUnit(data.distance()),
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityLinearPattern(pattern_info),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityLinearPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let geometries = match geometry {
        Geometry::Sketch(sketch) => {
            let mut geometries = vec![sketch.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_sketch = sketch.clone();
                new_sketch.id = *id;
                geometries.push(new_sketch);
            }
            Geometries::Sketches(geometries)
        }
        Geometry::Solid(solid) => {
            let mut geometries = vec![solid.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_solid = solid.clone();
                new_solid.id = *id;
                geometries.push(new_solid);
            }
            Geometries::Solids(geometries)
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
pub async fn pattern_circular_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch_set): (CircularPattern2dData, SketchSet) = args.get_data_and_sketch_set()?;

    let sketches = inner_pattern_circular_2d(data, sketch_set, exec_state, args).await?;
    Ok(sketches.into())
}

/// Repeat a 2-dimensional sketch some number of times along a partial or
/// complete circle some specified number of times. Each object may
/// additionally be rotated along the circle, ensuring orentation of the
/// solid with respect to the center of the circle is maintained.
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
    sketch_set: SketchSet,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Box<Sketch>>, KclError> {
    let starting_sketches: Vec<Box<Sketch>> = sketch_set.into();

    if args.ctx.context_type == crate::executor::ContextType::Mock {
        return Ok(starting_sketches);
    }

    let mut sketches = Vec::new();
    for sketch in starting_sketches.iter() {
        let geometries = pattern_circular(
            CircularPattern::TwoD(data.clone()),
            Geometry::Sketch(sketch.clone()),
            exec_state,
            args.clone(),
        )
        .await?;

        let Geometries::Sketches(new_sketches) = geometries else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected a vec of sketches".to_string(),
                source_ranges: vec![args.source_range],
            }));
        };

        sketches.extend(new_sketches);
    }

    Ok(sketches)
}

/// A circular pattern on a 3D model.
pub async fn pattern_circular_3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid_set): (CircularPattern3dData, SolidSet) = args.get_data_and_solid_set()?;

    let solids = inner_pattern_circular_3d(data, solid_set, exec_state, args).await?;
    Ok(solids.into())
}

/// Repeat a 3-dimensional solid some number of times along a partial or
/// complete circle some specified number of times. Each object may
/// additionally be rotated along the circle, ensuring orentation of the
/// solid with respect to the center of the circle is maintained.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> circle({ center: [0, 0], radius: 1 }, %)
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
    solid_set: SolidSet,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Box<Solid>>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not flush these, then you won't be able to pattern something with fillets.
    // Flush just the fillets/chamfers that apply to these solids.
    args.flush_batch_for_solid_set(exec_state, solid_set.clone().into())
        .await?;

    let starting_solids: Vec<Box<Solid>> = solid_set.into();

    if args.ctx.context_type == crate::executor::ContextType::Mock {
        return Ok(starting_solids);
    }

    let mut solids = Vec::new();
    for solid in starting_solids.iter() {
        let geometries = pattern_circular(
            CircularPattern::ThreeD(data.clone()),
            Geometry::Solid(solid.clone()),
            exec_state,
            args.clone(),
        )
        .await?;

        let Geometries::Solids(new_solids) = geometries else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected a vec of solids".to_string(),
                source_ranges: vec![args.source_range],
            }));
        };

        solids.extend(new_solids);
    }

    Ok(solids)
}

async fn pattern_circular(
    data: CircularPattern,
    geometry: Geometry,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Geometries, KclError> {
    let id = exec_state.id_generator.next_uuid();

    let center = data.center();
    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::EntityCircularPattern {
                axis: kcmc::shared::Point3d::from(data.axis()),
                entity_id: geometry.id(),
                center: kcmc::shared::Point3d {
                    x: LengthUnit(center[0]),
                    y: LengthUnit(center[1]),
                    z: LengthUnit(center[2]),
                },
                num_repetitions: data.repetitions(),
                arc_degrees: data.arc_degrees(),
                rotate_duplicates: data.rotate_duplicates(),
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityCircularPattern(pattern_info),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityCircularPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let geometries = match geometry {
        Geometry::Sketch(sketch) => {
            let mut geometries = vec![sketch.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_sketch = sketch.clone();
                new_sketch.id = *id;
                geometries.push(new_sketch);
            }
            Geometries::Sketches(geometries)
        }
        Geometry::Solid(solid) => {
            let mut geometries = vec![solid.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_solid = solid.clone();
                new_solid.id = *id;
                geometries.push(new_solid);
            }
            Geometries::Solids(geometries)
        }
    };

    Ok(geometries)
}
