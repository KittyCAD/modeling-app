use kcl_api::UnitArea;
use kcl_api::UnitDensity;
use kcl_api::UnitLength;
use kcl_api::UnitMass;
use kcl_api::UnitVolume;
use kcl_lib::unit_conversion::ToApi;
use kcl_lib::unit_conversion::ToKcmc;
use kittycad_modeling_cmds::ok_response::output as mout;
use kittycad_modeling_cmds::{self as kcmc};
use pyo3::PyResult;
use pyo3::exceptions::PyException;
use pyo3::pyclass;
use pyo3::pymethods;

use crate::bridge::bounding_box::BoundingBoxResponse;

/// Set of physical properties you'd like to run on the model.
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass(from_py_object)]
#[derive(Default, Debug, Clone)]
pub struct PhysicalPropertiesRequest {
    pub volume: Option<kcmc::Volume>,
    pub mass: Option<kcmc::Mass>,
    pub center_of_mass: Option<kcmc::CenterOfMass>,
    pub surface_area: Option<kcmc::SurfaceArea>,
    pub density: Option<kcmc::Density>,
    pub bounding_box: Option<kcmc::BoundingBox>,
}

impl PhysicalPropertiesRequest {
    pub(crate) fn modeling_cmd(&self) -> Option<kcmc::ModelingCmd> {
        let mut commands = [
            self.volume.clone().map(kcmc::ModelingCmd::from),
            self.mass.clone().map(kcmc::ModelingCmd::from),
            self.center_of_mass.clone().map(kcmc::ModelingCmd::from),
            self.surface_area.clone().map(kcmc::ModelingCmd::from),
            self.density.clone().map(kcmc::ModelingCmd::from),
            self.bounding_box.clone().map(kcmc::ModelingCmd::from),
        ]
        .into_iter()
        .flatten();
        let first = commands.next()?;
        if commands.next().is_none() {
            // In particular, bounding-box-only requests do not need a tessellation.
            return Some(first);
        }

        // Python setters always select the default scene. Supply valid inputs for
        // unrequested properties; their results are discarded by the caller.
        let mass = self.mass.as_ref();
        let density = self.density.as_ref();
        Some(kcmc::ModelingCmd::from(
            kcmc::PhysicalProperties::builder()
                .material_density(mass.map_or(1.0, |r| r.material_density))
                .material_density_unit(mass.map_or(Default::default(), |r| r.material_density_unit))
                .material_mass(density.map_or(1.0, |r| r.material_mass))
                .material_mass_unit(density.map_or(Default::default(), |r| r.material_mass_unit))
                .mass_output_unit(mass.map_or(Default::default(), |r| r.output_unit))
                .density_output_unit(density.map_or(Default::default(), |r| r.output_unit))
                .volume_output_unit(self.volume.as_ref().map_or(Default::default(), |r| r.output_unit))
                .center_of_mass_output_unit(
                    self.center_of_mass
                        .as_ref()
                        .map_or(Default::default(), |r| r.output_unit),
                )
                .surface_area_output_unit(self.surface_area.as_ref().map_or(Default::default(), |r| r.output_unit))
                .bounding_box_output_unit(self.bounding_box.as_ref().map_or(Default::default(), |r| r.output_unit))
                .build(),
        ))
    }
}

/// Resulting data from a `PhysicalPropertiesRequest`.
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass(from_py_object)]
#[derive(Default, Debug, Clone)]
pub struct PhysicalPropertiesResponse {
    pub volume: Option<mout::Volume>,
    pub mass: Option<mout::Mass>,
    pub center_of_mass: Option<mout::CenterOfMass>,
    pub surface_area: Option<mout::SurfaceArea>,
    pub density: Option<mout::Density>,
    pub bounding_box: Option<mout::BoundingBox>,
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl PhysicalPropertiesResponse {
    fn get_center_of_mass(&self) -> PyResult<super::Point3d> {
        let point = self
            .center_of_mass
            .clone()
            .ok_or(PyException::new_err("Center of mass was not requested"))?
            .center_of_mass;
        Ok(super::Point3d::from(point))
    }

    fn get_center_of_mass_unit(&self) -> PyResult<UnitLength> {
        let unit = self
            .center_of_mass
            .clone()
            .ok_or(PyException::new_err("Center of mass was not requested"))?
            .output_unit;
        Ok(unit.to_api())
    }

    fn get_volume(&self) -> PyResult<f64> {
        Ok(self
            .volume
            .as_ref()
            .ok_or(PyException::new_err("Volume was not requested"))?
            .volume)
    }

    fn get_volume_unit(&self) -> PyResult<UnitVolume> {
        Ok(self
            .volume
            .as_ref()
            .ok_or(PyException::new_err("Volume was not requested"))?
            .output_unit
            .to_api())
    }

    fn get_surface_area(&self) -> PyResult<f64> {
        Ok(self
            .surface_area
            .as_ref()
            .ok_or(PyException::new_err("Surface area was not requested"))?
            .surface_area)
    }

    fn get_surface_area_unit(&self) -> PyResult<UnitArea> {
        Ok(self
            .surface_area
            .as_ref()
            .ok_or(PyException::new_err("Surface area was not requested"))?
            .output_unit
            .to_api())
    }

    fn get_density(&self) -> PyResult<f64> {
        Ok(self
            .density
            .as_ref()
            .ok_or(PyException::new_err("Density was not requested"))?
            .density)
    }

    fn get_bounding_box(&self) -> PyResult<BoundingBoxResponse> {
        let bb = self
            .bounding_box
            .as_ref()
            .ok_or(PyException::new_err("Bounding box was not requested"))?;
        let bb = BoundingBoxResponse::from(bb);
        Ok(bb)
    }

    fn get_density_unit(&self) -> PyResult<UnitDensity> {
        Ok(self
            .density
            .as_ref()
            .ok_or(PyException::new_err("Density was not requested"))?
            .output_unit
            .to_api())
    }

    fn get_mass(&self) -> PyResult<f64> {
        Ok(self
            .mass
            .as_ref()
            .ok_or(PyException::new_err("Mass was not requested"))?
            .mass)
    }

    fn get_mass_unit(&self) -> PyResult<UnitMass> {
        Ok(self
            .mass
            .as_ref()
            .ok_or(PyException::new_err("Mass was not requested"))?
            .output_unit
            .to_api())
    }
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl PhysicalPropertiesRequest {
    #[new]
    /// Create a default PhysicalPropertiesRequest with no requests set.
    fn new() -> Self {
        Self::default()
    }

    /// Requests the volume of the model.
    fn set_volume(&mut self, output_unit: UnitVolume) {
        self.volume = Some(
            kcmc::Volume::builder()
                .output_unit(output_unit.to_kcmc())
                .entity_ids(Default::default())
                .build(),
        );
    }

    /// Requests the center of mass of the model.
    fn set_center_of_mass(&mut self, output_unit: UnitLength) {
        self.center_of_mass = Some(
            kcmc::CenterOfMass::builder()
                .output_unit(output_unit.to_kcmc())
                .entity_ids(Default::default())
                .build(),
        );
    }

    /// Requests the mass of the model.
    fn set_mass(
        &mut self,
        output_unit: UnitMass,
        material_density: f64,
        material_density_unit: UnitDensity,
    ) -> PyResult<()> {
        if material_density <= 0.0 {
            return Err(PyException::new_err("material_density must be greater than 0"));
        }
        self.mass = Some(
            kcmc::Mass::builder()
                .output_unit(output_unit.to_kcmc())
                .entity_ids(Default::default())
                .material_density(material_density)
                .material_density_unit(material_density_unit.to_kcmc())
                .build(),
        );
        Ok(())
    }

    /// Requests the surface area of the model.
    fn set_surface_area(&mut self, output_unit: UnitArea) {
        self.surface_area = Some(
            kcmc::SurfaceArea::builder()
                .output_unit(output_unit.to_kcmc())
                .entity_ids(Default::default())
                .build(),
        );
    }

    /// Requests the density of the model.
    fn set_density(
        &mut self,
        output_unit: UnitDensity,
        material_mass: f64,
        material_mass_unit: UnitMass,
    ) -> PyResult<()> {
        if material_mass <= 0.0 {
            return Err(PyException::new_err("material_mass must be greater than 0"));
        }
        self.density = Some(
            kcmc::Density::builder()
                .output_unit(output_unit.to_kcmc())
                .entity_ids(Default::default())
                .material_mass(material_mass)
                .material_mass_unit(material_mass_unit.to_kcmc())
                .build(),
        );
        Ok(())
    }

    /// Requests the bounding box of the model.
    fn set_bounding_box(&mut self, output_unit: UnitLength) -> PyResult<()> {
        self.bounding_box = Some(
            kcmc::BoundingBox::builder()
                .output_unit(output_unit.to_kcmc())
                .entity_ids(Default::default())
                .build(),
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_request_sends_no_command() {
        assert!(PhysicalPropertiesRequest::default().modeling_cmd().is_none());
    }

    #[test]
    fn single_property_keeps_its_original_command() {
        let mut request = PhysicalPropertiesRequest::default();
        request.set_bounding_box(UnitLength::Inches).unwrap();
        let Some(kcmc::ModelingCmd::BoundingBox(command)) = request.modeling_cmd() else {
            panic!("expected bounding box without tessellation");
        };
        assert_eq!(command.output_unit, kcmc::units::UnitLength::Inches);
    }

    #[test]
    fn multiple_properties_use_one_combined_command() {
        let mut request = PhysicalPropertiesRequest::default();
        request.set_volume(UnitVolume::CubicCentimeters);
        request.set_center_of_mass(UnitLength::Centimeters);
        request
            .set_mass(UnitMass::Grams, 7850.0, UnitDensity::KilogramsPerCubicMeter)
            .unwrap();
        request
            .set_density(UnitDensity::PoundsPerCubicFeet, 2.0, UnitMass::Pounds)
            .unwrap();
        request.set_surface_area(UnitArea::SquareFeet);
        request.set_bounding_box(UnitLength::Inches).unwrap();
        let Some(kcmc::ModelingCmd::PhysicalProperties(command)) = request.modeling_cmd() else {
            panic!("expected one combined physical properties command");
        };
        assert!(command.entity_ids.is_empty());
        assert_eq!(command.material_density, 7850.0);
        assert_eq!(
            command.material_density_unit,
            kcmc::units::UnitDensity::KilogramsPerCubicMeter
        );
        assert_eq!(command.material_mass, 2.0);
        assert_eq!(command.material_mass_unit, kcmc::units::UnitMass::Pounds);
        assert_eq!(command.mass_output_unit, kcmc::units::UnitMass::Grams);
        assert_eq!(
            command.density_output_unit,
            kcmc::units::UnitDensity::PoundsPerCubicFeet
        );
        assert_eq!(command.volume_output_unit, kcmc::units::UnitVolume::CubicCentimeters);
        assert_eq!(command.center_of_mass_output_unit, kcmc::units::UnitLength::Centimeters);
        assert_eq!(command.surface_area_output_unit, kcmc::units::UnitArea::SquareFeet);
        assert_eq!(command.bounding_box_output_unit, kcmc::units::UnitLength::Inches);
    }
}
