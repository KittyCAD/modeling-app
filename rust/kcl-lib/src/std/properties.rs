//! Standard library functions for solid part properties (BOM / cut list).

use std::collections::HashMap;

use indexmap::IndexMap;

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::BomEntry;
use crate::execution::ExecState;
use crate::execution::KclObjectFields;
use crate::execution::KclValue;
use crate::execution::Metadata;
use crate::execution::PropertyValue;
use crate::execution::Solid;
use crate::execution::types::RuntimeType;
use crate::std::Args;

/// Attach a part label and free-form properties to a solid.
pub async fn set_properties(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let mut solid: Solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let label: String = args.get_kw_arg("label", &RuntimeType::string(), exec_state)?;
    let properties_value: KclValue =
        args.get_kw_arg("properties", &RuntimeType::Object(vec![], false), exec_state)?;

    if label.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "The `label` argument to `setProperties` must be a non-empty string".to_owned(),
            vec![args.source_range],
        )));
    }

    let properties_fields = properties_value.into_object().ok_or_else(|| {
        KclError::new_semantic(KclErrorDetails::new(
            "The `properties` argument to `setProperties` must be an object".to_owned(),
            vec![args.source_range],
        ))
    })?;
    let properties = kcl_object_to_properties(&properties_fields, args.source_range)?;
    solid.set_bom_properties(label, properties);
    exec_state.bom_register_solid(&solid);

    Ok(KclValue::Solid {
        value: Box::new(solid),
    })
}

/// Read the label and properties previously attached with `setProperties`.
pub async fn get_properties(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid: Solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let Some(entry) = solid.bom_entry() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "This solid has no properties. Call `setProperties` first.".to_owned(),
            vec![args.source_range],
        )));
    };

    Ok(bom_entry_to_kcl_object(&entry, args.clone().into()))
}

/// Remove the label and properties from a solid and unregister it from the BOM.
pub async fn clear_properties(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let mut solid: Solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    exec_state.bom_unregister_solid(&solid);
    solid.clear_bom_properties();

    Ok(KclValue::Solid {
        value: Box::new(solid),
    })
}

fn kcl_object_to_properties(
    fields: &KclObjectFields,
    source_range: crate::SourceRange,
) -> Result<IndexMap<String, PropertyValue>, KclError> {
    let mut properties = IndexMap::with_capacity(fields.len());
    for (key, value) in fields {
        properties.insert(key.clone(), kcl_value_to_property_value(value, source_range)?);
    }
    Ok(properties)
}

fn kcl_value_to_property_value(value: &KclValue, source_range: crate::SourceRange) -> Result<PropertyValue, KclError> {
    match value {
        KclValue::String { value, .. } => Ok(PropertyValue::String { value: value.clone() }),
        KclValue::Number { value, ty, .. } => Ok(PropertyValue::Number {
            value: *value,
            ty: *ty,
        }),
        KclValue::Bool { value, .. } => Ok(PropertyValue::Bool { value: *value }),
        KclValue::Object { value, .. } => Ok(PropertyValue::Object {
            value: kcl_object_to_properties(value, source_range)?,
        }),
        other => Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Property values must be string, number, bool, or nested objects of those types, but found {}",
                other.human_friendly_type()
            ),
            vec![source_range],
        ))),
    }
}

fn property_value_to_kcl(value: &PropertyValue, meta: Vec<Metadata>) -> KclValue {
    match value {
        PropertyValue::String { value } => KclValue::String {
            value: value.clone(),
            meta,
        },
        PropertyValue::Number { value, ty } => KclValue::Number {
            value: *value,
            ty: *ty,
            meta,
        },
        PropertyValue::Bool { value } => KclValue::Bool {
            value: *value,
            meta,
        },
        PropertyValue::Object { value } => KclValue::Object {
            value: properties_to_kcl_object(value, meta.clone()),
            constrainable: false,
            object_kind: Default::default(),
            meta,
        },
    }
}

fn properties_to_kcl_object(properties: &IndexMap<String, PropertyValue>, meta: Vec<Metadata>) -> KclObjectFields {
    properties
        .iter()
        .map(|(key, value)| (key.clone(), property_value_to_kcl(value, meta.clone())))
        .collect()
}

fn bom_entry_to_kcl_object(entry: &BomEntry, meta: Vec<Metadata>) -> KclValue {
    let mut value = HashMap::new();
    value.insert(
        "label".to_owned(),
        KclValue::String {
            value: entry.label.clone(),
            meta: meta.clone(),
        },
    );
    value.insert(
        "properties".to_owned(),
        KclValue::Object {
            value: properties_to_kcl_object(&entry.properties, meta.clone()),
            constrainable: false,
            object_kind: Default::default(),
            meta: meta.clone(),
        },
    );
    KclValue::Object {
        value,
        constrainable: false,
        object_kind: Default::default(),
        meta,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::parse_execute;
    use crate::execution::types::NumericType;

    fn make_box_with_properties() -> &'static str {
        r#"
stud = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [45, 0])
  |> line(end = [0, 90])
  |> line(end = [-45, 0])
  |> close()
  |> extrude(length = 1550)
  |> setProperties(
       label = "stud",
       properties = {
         sku = "90x45",
         length = 1550mm,
         nested = { endA = 90deg },
       },
     )
"#
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn set_and_get_properties_round_trip() {
        let code = format!(
            r#"
{}
info = getProperties(stud)
"#,
            make_box_with_properties()
        );
        let result = parse_execute(&code).await.unwrap();
        assert_eq!(result.exec_state.bom_len(), 1);

        let info = result
            .exec_state
            .stack()
            .memory
            .get_from_unchecked("info", result.mem_env)
            .unwrap();
        let obj = info.as_object().unwrap();
        assert_eq!(obj.get("label").unwrap().as_str().unwrap(), "stud");

        let props = obj.get("properties").unwrap().as_object().unwrap();
        assert_eq!(props.get("sku").unwrap().as_str().unwrap(), "90x45");
        let length = props.get("length").unwrap().as_f64().unwrap();
        assert!((length - 1550.0).abs() < 1e-9);

        let nested = props.get("nested").unwrap().as_object().unwrap();
        assert!((nested.get("endA").unwrap().as_f64().unwrap() - 90.0).abs() < 1e-9);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn clear_properties_unregisters_from_bom() {
        let code = format!(
            r#"
{}
cleared = clearProperties(stud)
"#,
            make_box_with_properties()
        );
        let result = parse_execute(&code).await.unwrap();
        assert_eq!(result.exec_state.bom_len(), 0);

        let cleared = result
            .exec_state
            .stack()
            .memory
            .get_from_unchecked("cleared", result.mem_env)
            .unwrap();
        let solid = match cleared {
            KclValue::Solid { value } => value,
            other => panic!("expected solid, got {other:?}"),
        };
        assert!(!solid.has_bom_entry());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn get_properties_errors_when_unset() {
        let code = r#"
box = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
  |> extrude(length = 5)

info = getProperties(box)
"#;
        let err = parse_execute(code).await.unwrap_err();
        assert!(
            err.message().contains("no properties"),
            "unexpected error: {}",
            err.message()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn set_properties_rejects_geometry_values() {
        let code = r#"
box = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
  |> extrude(length = 5)

bad = setProperties(box, label = "part", properties = { body = box })
"#;
        let err = parse_execute(code).await.unwrap_err();
        assert!(
            err.message().contains("Property values must be"),
            "unexpected error: {}",
            err.message()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn properties_survive_translate() {
        let code = format!(
            r#"
{}
moved = translate(stud, x = 100)
info = getProperties(moved)
"#,
            make_box_with_properties()
        );
        let result = parse_execute(&code).await.unwrap();
        let info = result
            .exec_state
            .stack()
            .memory
            .get_from_unchecked("info", result.mem_env)
            .unwrap();
        assert_eq!(
            info.as_object().unwrap().get("label").unwrap().as_str().unwrap(),
            "stud"
        );
        // Same artifact id → still one registry entry (upsert).
        assert_eq!(result.exec_state.bom_len(), 1);
    }

    #[test]
    fn property_value_round_trip_helpers() {
        let mut props = IndexMap::new();
        props.insert(
            "length".to_owned(),
            PropertyValue::Number {
                value: 1550.0,
                ty: NumericType::default(),
            },
        );
        props.insert(
            "sku".to_owned(),
            PropertyValue::String {
                value: "90x45".to_owned(),
            },
        );
        let entry = BomEntry::new("stud", props);
        let kcl = bom_entry_to_kcl_object(&entry, Vec::new());
        let obj = kcl.as_object().unwrap();
        assert_eq!(obj.get("label").unwrap().as_str().unwrap(), "stud");
        let back = kcl_object_to_properties(obj.get("properties").unwrap().as_object().unwrap(), Default::default())
            .unwrap();
        assert_eq!(back.get("sku").unwrap(), &PropertyValue::String {
            value: "90x45".to_owned()
        });
    }
}
