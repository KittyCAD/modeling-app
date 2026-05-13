//! Standard library functions for model-based definition (MBD).

use crate::ExecState;
use crate::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::EntityKind;
use crate::execution::Face;
use crate::execution::KclValue;
use crate::execution::TagIdentifier;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::FromKclValue;
use crate::std::fillet::EdgeReference;

/// Maximum allowed length, in characters, of a name.
const MAX_NAME_LENGTH: usize = 1024;

/// A face passed to `name`, either as a `Face` value or a `TaggedFace`. We
/// keep the two cases separate so that a tag is resolved to its adjacent
/// face UUID rather than being treated as an edge UUID.
#[derive(Debug, Clone)]
enum NamedFace {
    Face(Box<Face>),
    Tagged(Box<TagIdentifier>),
}

impl<'a> FromKclValue<'a> for NamedFace {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Face { value } => Some(Self::Face(value.to_owned())),
            KclValue::TagIdentifier(value) => Some(Self::Tagged(value.to_owned())),
            _ => None,
        }
    }
}

fn face_arg_type() -> RuntimeType {
    RuntimeType::Union(vec![RuntimeType::face(), RuntimeType::tagged_face()])
}

pub async fn name(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let face: Option<NamedFace> = args.get_kw_arg_opt("face", &face_arg_type(), exec_state)?;
    let edge: Option<EdgeReference> = args.get_kw_arg_opt("edge", &RuntimeType::edge(), exec_state)?;
    let name_value: String = args.get_kw_arg("name", &RuntimeType::string(), exec_state)?;

    inner_name(face, edge, name_value, exec_state, &args).await?;
    Ok(KclValue::none())
}

async fn inner_name(
    face: Option<NamedFace>,
    edge: Option<EdgeReference>,
    name: String,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<(), KclError> {
    if face.is_some() && edge.is_some() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Only one of `face` or `edge` may be provided to `name`, not both.".to_owned(),
            vec![args.source_range],
        )));
    }

    validate_name(&name, args)?;

    let (uuid, kind) = match (face, edge) {
        (Some(face), None) => {
            let id = match face {
                NamedFace::Face(face) => face.id,
                NamedFace::Tagged(tag) => args.get_adjacent_face_to_tag(exec_state, &tag, false).await?,
            };
            (id, EntityKind::Face)
        }
        (None, Some(edge)) => (edge.get_engine_id(exec_state, args)?, EntityKind::Edge),
        (None, None) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "One of `face` or `edge` must be provided to `name`.".to_owned(),
                vec![args.source_range],
            )));
        }
        (Some(_), Some(_)) => unreachable!(),
    };

    if name.is_empty() {
        exec_state.remove_entity_name(&uuid);
    } else {
        exec_state.set_entity_name(uuid, name, kind);
    }

    Ok(())
}

fn validate_name(name: &str, args: &Args) -> Result<(), KclError> {
    if name.is_empty() {
        // An empty string clears any existing name; nothing else to validate.
        return Ok(());
    }
    if name.len() > MAX_NAME_LENGTH {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Name is {} characters long, but the maximum allowed length is {}.",
                name.len(),
                MAX_NAME_LENGTH,
            ),
            vec![args.source_range],
        )));
    }
    if let Some(bad) = name.chars().find(|c| !is_allowed_name_char(*c)) {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Name contains the disallowed character {bad:?}. Only ASCII characters are allowed. ASCII control and signle-quote characters are also disallowed.",
            ),
            vec![args.source_range],
        )));
    }
    Ok(())
}

fn is_allowed_name_char(c: char) -> bool {
    c.is_ascii() && !c.is_ascii_control() && c != '\''
}
