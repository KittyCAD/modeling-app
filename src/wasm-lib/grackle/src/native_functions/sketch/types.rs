use kittycad_execution_plan::Instruction;
use kittycad_execution_plan_macros::ExecutionPlanValue;
use kittycad_execution_plan_traits::{Address, Value};
use kittycad_modeling_cmds::shared::{Point2d, Point3d, Point4d};
use uuid::Uuid;

/// A sketch group is a collection of paths.
#[derive(Clone, ExecutionPlanValue)]
pub struct SketchGroup {
    /// The id of the sketch group.
    pub id: Uuid,
    /// What the sketch is on (can be a plane or a face).
    pub on: SketchSurface,
    /// The position of the sketch group.
    pub position: Point3d,
    /// The rotation of the sketch group base plane.
    pub rotation: Point4d,
    /// The X, Y and Z axes of this sketch's base plane, in 3D space.
    pub axes: Axes,
    /// The plane id or face id of the sketch group.
    pub entity_id: Option<Uuid>,
    /// The base path.
    pub path_first: BasePath,
    /// Paths after the first path, if any.
    pub path_rest: Vec<Path>,
}

impl SketchGroup {
    pub fn set_base_path(&self, sketch_group: Address, start_point: Address, tag: Option<Address>) -> Vec<Instruction> {
        let base_path_addr = sketch_group
            + self.id.into_parts().len()
            + self.on.into_parts().len()
            + self.position.into_parts().len()
            + self.rotation.into_parts().len()
            + self.axes.into_parts().len()
            + self.entity_id.into_parts().len()
            + self.entity_id.into_parts().len();
        let mut out = vec![
            // Copy over the `from` field.
            Instruction::Copy {
                source: start_point,
                destination: base_path_addr,
            },
            // Copy over the `to` field.
            Instruction::Copy {
                source: start_point,
                destination: base_path_addr + self.path_first.from.into_parts().len(),
            },
        ];
        if let Some(tag) = tag {
            // Copy over the `name` field.
            out.push(Instruction::Copy {
                source: tag,
                destination: base_path_addr
                    + self.path_first.from.into_parts().len()
                    + self.path_first.to.into_parts().len(),
            });
        }
        out
    }
}

/// The X, Y and Z axes.
#[derive(Clone, Copy, ExecutionPlanValue)]
pub struct Axes {
    pub x: Point3d,
    pub y: Point3d,
    pub z: Point3d,
}

#[derive(Clone, ExecutionPlanValue)]
pub struct BasePath {
    pub from: Point2d<f64>,
    pub to: Point2d<f64>,
    pub name: String,
}

/// A path.
#[derive(Clone, ExecutionPlanValue)]
pub enum Path {
    /// A path that goes to a point.
    ToPoint { base: BasePath },
    /// A arc that is tangential to the last path segment that goes to a point
    TangentialArcTo {
        base: BasePath,
        /// the arc's center
        center: Point2d,
        /// arc's direction
        ccw: bool,
    },
    /// A path that is horizontal.
    Horizontal {
        base: BasePath,
        /// The x coordinate.
        x: f64,
    },
    /// An angled line to.
    AngledLineTo {
        base: BasePath,
        /// The x coordinate.
        x: Option<f64>,
        /// The y coordinate.
        y: Option<f64>,
    },
    /// A base path.
    Base { base: BasePath },
}

#[derive(Clone, Copy, ExecutionPlanValue)]
pub enum SketchSurface {
    Plane(Plane),
}

/// A plane.
#[derive(Clone, Copy, ExecutionPlanValue)]
pub struct Plane {
    /// The id of the plane.
    pub id: Uuid,
    // The code for the plane either a string or custom.
    pub value: PlaneType,
    /// Origin of the plane.
    pub origin: Point3d,
    pub axes: Axes,
}

/// Type for a plane.
#[derive(Clone, Copy, ExecutionPlanValue)]
pub enum PlaneType {
    XY,
    XZ,
    YZ,
    Custom,
}
