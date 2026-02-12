use kittycad_modeling_cmds::{self as kcmc, ok_response::output as mout, units::*};
use pyo3::{exceptions::PyException, pyclass, pymethods, PyResult};

/// Set of physical properties you'd like to run on the model.
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass]
#[derive(Default, Debug, Clone)]
pub struct PhysicalPropertiesRequest {
    pub volume: Option<kcmc::Volume>,
    pub mass: Option<kcmc::Mass>,
    pub center_of_mass: Option<kcmc::CenterOfMass>,
    pub surface_area: Option<kcmc::SurfaceArea>,
    pub density: Option<kcmc::Density>,
}

/// Resulting data from a `PhysicalPropertiesRequest`.
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass]
#[derive(Default, Debug, Clone)]
pub struct PhysicalPropertiesResponse {
    pub volume: Option<mout::Volume>,
    pub mass: Option<mout::Mass>,
    pub center_of_mass: Option<mout::CenterOfMass>,
    pub surface_area: Option<mout::SurfaceArea>,
    pub density: Option<mout::Density>,
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
        Ok(unit)
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
            .output_unit)
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
            .output_unit)
    }

    fn get_density(&self) -> PyResult<f64> {
        Ok(self
            .density
            .as_ref()
            .ok_or(PyException::new_err("Density was not requested"))?
            .density)
    }

    fn get_density_unit(&self) -> PyResult<UnitDensity> {
        Ok(self
            .density
            .as_ref()
            .ok_or(PyException::new_err("Density was not requested"))?
            .output_unit)
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
            .output_unit)
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
                .output_unit(output_unit)
                .entity_ids(Default::default())
                .build(),
        );
    }

    /// Requests the center of mass of the model.
    fn set_center_of_mass(&mut self, output_unit: UnitLength) {
        self.center_of_mass = Some(
            kcmc::CenterOfMass::builder()
                .output_unit(output_unit)
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
                .output_unit(output_unit)
                .entity_ids(Default::default())
                .material_density(material_density)
                .material_density_unit(material_density_unit)
                .build(),
        );
        Ok(())
    }

    /// Requests the surface area of the model.
    fn set_surface_area(&mut self, output_unit: UnitArea) {
        self.surface_area = Some(
            kcmc::SurfaceArea::builder()
                .output_unit(output_unit)
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
                .output_unit(output_unit)
                .entity_ids(Default::default())
                .material_mass(material_mass)
                .material_mass_unit(material_mass_unit)
                .build(),
        );
        Ok(())
    }
}
