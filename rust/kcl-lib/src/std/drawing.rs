//! Drawing sheet constructors and runtime values.

use kcl_api::SheetOrientation;
pub use kcl_api::StandardSheetSize;
use kcl_api::UnitLength;
use serde::Serialize;

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::Metadata;
use crate::execution::types::NumericType;
use crate::execution::types::NumericTypeExt;
use crate::execution::types::RuntimeType;
use crate::execution::types::UnitType;
use crate::std::Args;
use crate::std::args::FromKclValue;
use crate::std::args::TyF64;

impl FromKclValue<'_> for SheetOrientation {
    fn from_kcl_val(arg: &KclValue) -> Option<Self> {
        let KclValue::Enum { value } = arg else {
            return None;
        };
        match value.variant() {
            "Landscape" => Some(Self::Landscape),
            "Portrait" => Some(Self::Portrait),
            _ => None,
        }
    }
}

struct PresetSize {
    name: &'static str,
    short_side: TyF64,
    long_side: TyF64,
}

impl PresetSize {
    const fn new(name: &'static str, short_side: f64, long_side: f64, unit: UnitLength) -> Self {
        let ty = NumericType::Known(UnitType::Length(unit));
        Self {
            name,
            short_side: TyF64::new(short_side, ty),
            long_side: TyF64::new(long_side, ty),
        }
    }

    const ANSI_A: Self = Self::new("ANSI A", 8.5, 11.0, UnitLength::Inches);
    const ANSI_B: Self = Self::new("ANSI B", 11.0, 17.0, UnitLength::Inches);
    const ANSI_C: Self = Self::new("ANSI C", 17.0, 22.0, UnitLength::Inches);
    const ANSI_D: Self = Self::new("ANSI D", 22.0, 34.0, UnitLength::Inches);
    const ANSI_E: Self = Self::new("ANSI E", 34.0, 44.0, UnitLength::Inches);
    const ISO_A0: Self = Self::new("ISO A0", 841.0, 1189.0, UnitLength::Millimeters);
    const ISO_A1: Self = Self::new("ISO A1", 594.0, 841.0, UnitLength::Millimeters);
    const ISO_A2: Self = Self::new("ISO A2", 420.0, 594.0, UnitLength::Millimeters);
    const ISO_A3: Self = Self::new("ISO A3", 297.0, 420.0, UnitLength::Millimeters);
    const ISO_A4: Self = Self::new("ISO A4", 210.0, 297.0, UnitLength::Millimeters);

    fn info(preset: StandardSheetSize) -> SheetSizeInfo<'static> {
        let preset = match preset {
            StandardSheetSize::AnsiA => &Self::ANSI_A,
            StandardSheetSize::AnsiB => &Self::ANSI_B,
            StandardSheetSize::AnsiC => &Self::ANSI_C,
            StandardSheetSize::AnsiD => &Self::ANSI_D,
            StandardSheetSize::AnsiE => &Self::ANSI_E,
            StandardSheetSize::IsoA0 => &Self::ISO_A0,
            StandardSheetSize::IsoA1 => &Self::ISO_A1,
            StandardSheetSize::IsoA2 => &Self::ISO_A2,
            StandardSheetSize::IsoA3 => &Self::ISO_A3,
            StandardSheetSize::IsoA4 => &Self::ISO_A4,
        };
        SheetSizeInfo {
            name: preset.name,
            short_side: &preset.short_side,
            long_side: &preset.long_side,
        }
    }
}

impl FromKclValue<'_> for StandardSheetSize {
    fn from_kcl_val(arg: &KclValue) -> Option<Self> {
        let KclValue::Enum { value } = arg else {
            return None;
        };
        match value.variant() {
            "AnsiA" => Some(Self::AnsiA),
            "AnsiB" => Some(Self::AnsiB),
            "AnsiC" => Some(Self::AnsiC),
            "AnsiD" => Some(Self::AnsiD),
            "AnsiE" => Some(Self::AnsiE),
            "IsoA0" => Some(Self::IsoA0),
            "IsoA1" => Some(Self::IsoA1),
            "IsoA2" => Some(Self::IsoA2),
            "IsoA3" => Some(Self::IsoA3),
            "IsoA4" => Some(Self::IsoA4),
            _ => None,
        }
    }
}

/// A named custom size with validated side lengths.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSheetSize {
    name: String,
    short_side: TyF64,
    long_side: TyF64,
}

/// The size selected when a drawing sheet was created.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SheetSize {
    Standard { preset: StandardSheetSize },
    Custom(Box<CustomSheetSize>),
}

/// The name and side lengths of a sheet size in its stored units.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetSizeInfo<'a> {
    pub name: &'a str,
    pub short_side: &'a TyF64,
    pub long_side: &'a TyF64,
}

impl SheetSize {
    /// Return the name and side lengths ordered by physical size.
    pub fn info(&self) -> SheetSizeInfo<'_> {
        match self {
            Self::Standard { preset } => PresetSize::info(*preset),
            Self::Custom(size) => SheetSizeInfo {
                name: &size.name,
                short_side: &size.short_side,
                long_side: &size.long_side,
            },
        }
    }
}

/// A drawing sheet with side lengths ordered by physical size, each in its original units.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    size: SheetSize,
    orientation: SheetOrientation,
    #[serde(skip)]
    meta: Vec<Metadata>,
}

impl Sheet {
    /// Return the standard preset or the custom size selected at construction.
    pub fn size(&self) -> &SheetSize {
        &self.size
    }

    pub(crate) fn orientation(&self) -> SheetOrientation {
        self.orientation
    }

    /// The width and height in the selected orientation, each in its stored units.
    pub fn dimensions(&self) -> (&TyF64, &TyF64) {
        let size = self.size().info();
        match self.orientation {
            SheetOrientation::Landscape => (size.long_side, size.short_side),
            SheetOrientation::Portrait => (size.short_side, size.long_side),
        }
    }

    pub(crate) fn meta(&self) -> &[Metadata] {
        &self.meta
    }
}

pub(crate) async fn create_sheet(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let preset = args.get_kw_arg("size", &RuntimeType::any(), exec_state)?;
    let orientation = args.get_kw_arg("orientation", &RuntimeType::any(), exec_state)?;
    let value = Sheet {
        size: SheetSize::Standard { preset },
        orientation,
        meta: vec![args.source_range.into()],
    };
    Ok(KclValue::Sheet { value: Box::new(value) })
}

pub(crate) async fn create_custom_sheet(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (width, width_unit) = validated_length("width", &args, exec_state)?;
    let (height, height_unit) = validated_length("height", &args, exec_state)?;
    let orientation = args.get_kw_arg("orientation", &RuntimeType::any(), exec_state)?;
    let name: String = args.get_kw_arg("name", &RuntimeType::string(), exec_state)?;
    if name.trim().is_empty() {
        return Err(invalid_arg(
            &args,
            "name",
            "Sheet name must contain a non-whitespace character.".to_owned(),
        ));
    }

    // Compare in the larger unit so the conversion cannot overflow.
    let width_unit_in_height = width_unit.convert_to(height_unit, 1.0);
    let width_is_shorter_or_equal = if width_unit_in_height <= 1.0 {
        width.n * width_unit_in_height <= height.n
    } else {
        width.n <= height.n * height_unit.convert_to(width_unit, 1.0)
    };
    let (short_side, long_side) = if width_is_shorter_or_equal {
        (width, height)
    } else {
        (height, width)
    };
    let value = Sheet {
        size: SheetSize::Custom(Box::new(CustomSheetSize {
            name,
            short_side,
            long_side,
        })),
        orientation,
        meta: vec![args.source_range.into()],
    };
    Ok(KclValue::Sheet { value: Box::new(value) })
}

fn validated_length(label: &str, args: &Args, exec_state: &mut ExecState) -> Result<(TyF64, UnitLength), KclError> {
    let length: TyF64 = args.get_kw_arg(label, &RuntimeType::length(), exec_state)?;
    if let Some(unit) = length.ty.as_length()
        && length.n.is_finite()
        && length.n > 0.0
    {
        Ok((length, unit))
    } else {
        Err(invalid_arg(
            args,
            label,
            format!("Sheet `{label}` must be a finite, positive length."),
        ))
    }
}

fn invalid_arg(args: &Args, label: &str, message: String) -> KclError {
    let range = args
        .labeled
        .get(label)
        .map_or(args.source_range, |arg| arg.source_range);
    KclError::new_semantic(KclErrorDetails::new(message, vec![range]))
}

#[cfg(test)]
mod tests {
    use std::fmt::Write as _;
    use std::sync::Arc;

    use serde_json::json;

    use super::*;
    use crate::ExecOutcome;
    use crate::ExecutorContext;
    use crate::Program;
    use crate::engine::engine_manager::EngineManager;
    use crate::execution::KclValueView;

    const PREVIEW: &str = "@settings(kclVersion = \"4.0-preview\")\n";
    const PORTRAIT: &str = "drawing::SheetOrientation::Portrait";

    async fn execute(code: &str) -> Result<ExecOutcome, KclError> {
        let program = Program::parse_no_errs(code).unwrap();
        let ctx = ExecutorContext::new_with_engine(Arc::new(EngineManager::new_mock()), Default::default());
        assert!(!ctx.is_mock());
        let mut state = ExecState::new(&ctx);
        let result = match ctx.run(&program, &mut state).await {
            Ok((environment, _)) => state.into_exec_outcome(environment, &ctx).await,
            Err(error) => Err(error.error),
        };
        ctx.close().await;
        result
    }

    fn sheet<'a>(outcome: &'a ExecOutcome, variable: &str) -> &'a Sheet {
        let KclValue::Sheet { value } = &outcome.test_program_memory[variable] else {
            panic!("{variable} should be a drawing sheet");
        };
        assert!(matches!(outcome.variables[variable], KclValueView::Sheet { .. }));
        value
    }

    #[tokio::test]
    async fn creates_all_standard_sizes_in_both_orientations() {
        use UnitLength::Inches;
        use UnitLength::Millimeters;

        let sizes = [
            (StandardSheetSize::AnsiA, "ANSI A", 8.5, 11.0, Inches),
            (StandardSheetSize::AnsiB, "ANSI B", 11.0, 17.0, Inches),
            (StandardSheetSize::AnsiC, "ANSI C", 17.0, 22.0, Inches),
            (StandardSheetSize::AnsiD, "ANSI D", 22.0, 34.0, Inches),
            (StandardSheetSize::AnsiE, "ANSI E", 34.0, 44.0, Inches),
            (StandardSheetSize::IsoA0, "ISO A0", 841.0, 1189.0, Millimeters),
            (StandardSheetSize::IsoA1, "ISO A1", 594.0, 841.0, Millimeters),
            (StandardSheetSize::IsoA2, "ISO A2", 420.0, 594.0, Millimeters),
            (StandardSheetSize::IsoA3, "ISO A3", 297.0, 420.0, Millimeters),
            (StandardSheetSize::IsoA4, "ISO A4", 210.0, 297.0, Millimeters),
        ];
        let mut code = PREVIEW.to_owned();
        for (preset, ..) in sizes {
            for orientation in ["Portrait", "Landscape"] {
                writeln!(
                    code,
                    "{preset:?}{orientation} = drawing::standardSheet(size = drawing::SheetSize::{preset:?}, orientation = drawing::SheetOrientation::{orientation})"
                )
                .unwrap();
            }
        }

        let outcome = execute(&code).await.unwrap();
        for (preset, name, short_side, long_side, unit) in sizes {
            let short_side = TyF64::new(short_side, NumericType::length(unit));
            let long_side = TyF64::new(long_side, NumericType::length(unit));
            let portrait = sheet(&outcome, &format!("{preset:?}Portrait"));
            assert_eq!(portrait.size(), &SheetSize::Standard { preset });
            assert_eq!(portrait.size().info().name, name);
            assert_eq!(portrait.dimensions(), (&short_side, &long_side));
            let landscape = sheet(&outcome, &format!("{preset:?}Landscape"));
            assert_eq!(landscape.size(), &SheetSize::Standard { preset });
            assert_eq!(landscape.size().info().name, name);
            assert_eq!(landscape.dimensions(), (&long_side, &short_side));
        }
    }

    #[tokio::test]
    async fn custom_size_retains_its_kind_when_it_matches_a_preset() {
        let outcome = execute(&format!(
            r#"{PREVIEW}
standard = drawing::standardSheet(size = drawing::SheetSize::IsoA4, orientation = drawing::SheetOrientation::Landscape)
custom = drawing::customSheet(width = 210mm, height = 297mm, orientation = drawing::SheetOrientation::Landscape, name = "ISO A4")
"#
        ))
        .await
        .unwrap();

        let standard = sheet(&outcome, "standard");
        let custom = sheet(&outcome, "custom");
        assert_eq!(
            standard.size(),
            &SheetSize::Standard {
                preset: StandardSheetSize::IsoA4
            }
        );
        assert!(matches!(custom.size(), SheetSize::Custom(_)));
        let info = standard.size().info();
        assert_eq!(custom.size().info(), info);

        let millimeters = json!({ "type": "Known", "value": { "type": "Length", "value": "mm" } });
        let short_side = json!({ "n": 210.0, "ty": millimeters });
        let long_side = json!({ "n": 297.0, "ty": millimeters });
        let standard_source = json!({ "kind": "standard", "preset": "IsoA4" });
        let custom_source = json!({ "kind": "custom" });
        assert_eq!(
            serde_json::to_value(standard).unwrap(),
            json!({
                "size": standard_source,
                "orientation": "Landscape",
            })
        );
        assert_eq!(
            serde_json::to_value(custom).unwrap(),
            json!({
                "size": {
                    "kind": "custom",
                    "name": "ISO A4",
                    "shortSide": short_side,
                    "longSide": long_side,
                },
                "orientation": "Landscape",
            })
        );

        for (variable, size_source) in [("standard", standard_source), ("custom", custom_source)] {
            let view = &outcome.variables[variable];
            let expected = json!({
                "type": "Sheet",
                "value": {
                    "sizeSource": size_source,
                    "name": "ISO A4",
                    "orientation": "Landscape",
                    "width": long_side,
                    "height": short_side,
                },
            });
            assert_eq!(serde_json::to_value(view).unwrap(), expected);
            assert_eq!(&serde_json::from_value::<KclValueView>(expected).unwrap(), view);
        }
    }

    #[tokio::test]
    async fn custom_lengths_keep_their_units_when_ordered_by_physical_size() {
        let large_width = 1e308;
        let large_height = 2e306;
        let outcome = execute(&format!(
            r#"@settings(kclVersion = "4.0-preview", defaultLengthUnit = cm)
portrait = drawing::customSheet(width = 2inch, height = 12mm, orientation = {PORTRAIT}, name = " Poster ")
landscape = drawing::customSheet(width = 0.5cm, height = 10mm, orientation = drawing::SheetOrientation::Landscape, name = "Detail")
square = drawing::customSheet(width = 3, height = 30mm, orientation = drawing::SheetOrientation::Landscape, name = "Square")
large = drawing::customSheet(width = {large_width:.0}cm, height = {large_height:.0}m, orientation = {PORTRAIT}, name = "Large")
fn acceptSheet(@value: drawing::Sheet): drawing::Sheet {{ return value }}
typed = acceptSheet(square)
"#
        ))
        .await
        .unwrap();

        let portrait = sheet(&outcome, "portrait");
        let info = portrait.size().info();
        assert_eq!(info.name, " Poster ");
        assert_eq!(portrait.orientation, SheetOrientation::Portrait);
        assert_eq!(*info.short_side, TyF64::new(12.0, NumericType::mm()));
        assert_eq!(
            *info.long_side,
            TyF64::new(2.0, NumericType::length(UnitLength::Inches))
        );
        let (width, height) = portrait.dimensions();
        assert_eq!(width.to_mm(), Some(12.0));
        assert!((height.to_mm().unwrap() - 50.8).abs() < 1e-10);

        let landscape = sheet(&outcome, "landscape");
        let (width, height) = landscape.dimensions();
        assert_eq!(*width, TyF64::new(10.0, NumericType::mm()));
        assert_eq!(*height, TyF64::new(0.5, NumericType::length(UnitLength::Centimeters)));
        assert_eq!(
            serde_json::to_value(&outcome.variables["landscape"]).unwrap(),
            json!({
                "type": "Sheet",
                "value": {
                    "sizeSource": { "kind": "custom" },
                    "name": "Detail",
                    "orientation": "Landscape",
                    "width": { "n": 10.0, "ty": { "type": "Known", "value": { "type": "Length", "value": "mm" } } },
                    "height": { "n": 0.5, "ty": { "type": "Known", "value": { "type": "Length", "value": "cm" } } },
                },
            })
        );

        let square = sheet(&outcome, "square");
        let (width, height) = square.dimensions();
        assert_eq!(width.to_mm(), Some(30.0));
        assert_eq!(height.to_mm(), Some(30.0));
        assert_eq!(height.ty.as_length(), Some(UnitLength::Centimeters));
        assert_eq!(square.orientation, SheetOrientation::Landscape);
        assert_eq!(sheet(&outcome, "typed"), square);

        let large = sheet(&outcome, "large").size().info();
        assert_eq!(
            *large.short_side,
            TyF64::new(large_width, NumericType::length(UnitLength::Centimeters))
        );
        assert_eq!(
            *large.long_side,
            TyF64::new(large_height, NumericType::length(UnitLength::Meters))
        );
    }

    #[tokio::test]
    async fn rejects_invalid_custom_dimensions_and_names() {
        let cases = [
            ("0mm", "1mm", r#""Detail""#, "`width`"),
            ("1mm", "-2mm", r#""Detail""#, "`height`"),
            ("1mm / 0", "1mm", r#""Detail""#, "`width`"),
            ("1mm", "0mm / 0", r#""Detail""#, "`height`"),
            ("1mm", "1mm", r#""""#, "non-whitespace character"),
            ("1mm", "1mm", r#""   ""#, "non-whitespace character"),
        ];
        for (width, height, name, expected) in cases {
            let code = format!(
                "{PREVIEW}sheet = drawing::customSheet(width = {width}, height = {height}, orientation = {PORTRAIT}, name = {name})"
            );
            let error = execute(&code).await.unwrap_err();
            assert!(error.message().contains(expected), "{code}\n{error}");
        }
    }

    #[tokio::test]
    async fn requires_constructor_arguments() {
        let calls = [
            (
                "drawing::standardSheet(size = drawing::SheetSize::IsoA4)",
                "orientation",
            ),
            (
                r#"drawing::customSheet(width = 1mm, height = 2mm, name = "Detail")"#,
                "orientation",
            ),
            (
                "drawing::customSheet(width = 1mm, height = 2mm, orientation = drawing::SheetOrientation::Portrait)",
                "name",
            ),
        ];
        for (call, argument) in calls {
            let code = format!("{PREVIEW}sheet = {call}");
            let error = execute(&code).await.unwrap_err();
            assert!(error.message().contains(argument), "{code}\n{error}");
        }
    }

    #[tokio::test]
    async fn rejects_a_record_as_a_sheet() {
        let code = format!(
            "{PREVIEW}fn acceptSheet(@value: drawing::Sheet): drawing::Sheet {{ return value }}\naccepted = acceptSheet({{ width = 20mm, height = 30mm }})"
        );
        let error = execute(&code).await.unwrap_err();
        assert!(error.message().contains("Sheet"), "{error}");
    }

    #[tokio::test]
    async fn drawing_declarations_require_kcl_four() {
        let compatible = "@settings(kclVersion = 3.0)\nvalue = 2mm";
        execute(compatible).await.unwrap();

        for body in [
            "value = drawing",
            "value = drawing::SheetOrientation::Portrait",
            "value = drawing::standardSheet()",
            "value = drawing::customSheet()",
            "fn acceptSheet(@value: drawing::Sheet) { return value }",
        ] {
            let code = format!("@settings(kclVersion = 3.0)\n{body}");
            let error = execute(&code).await.unwrap_err();
            assert!(error.message().contains("added in KCL 4.0"), "{code}\n{error}");
        }
    }

    #[tokio::test]
    async fn explicit_drawing_import_requires_kcl_four() {
        let code = "@settings(kclVersion = 3.0, experimentalFeatures = allow)\nimport \"std::drawing\"";
        let error = execute(code).await.unwrap_err();
        assert_eq!(
            error.message(),
            "The `std::drawing` module requires KCL 4.0-preview, but this program uses KCL 3.0."
        );

        let code = r#"@no_std
@settings(kclVersion = "4.0-preview", experimentalFeatures = allow)
import "std::drawing"
sheet = drawing::standardSheet(size = drawing::SheetSize::IsoA4, orientation = drawing::SheetOrientation::Portrait)
"#;
        let outcome = execute(code).await.unwrap();
        assert_eq!(sheet(&outcome, "sheet").orientation(), SheetOrientation::Portrait);
    }
}
