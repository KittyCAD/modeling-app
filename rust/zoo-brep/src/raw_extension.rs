use serde_json::Value;
use thiserror::Error;

pub const ZOO_BREP_EXTENSION: &str = "KITTYCAD_boundary_representation";

const GLB_MAGIC: &[u8; 4] = b"glTF";
const GLB_VERSION_2: u32 = 2;
const JSON_CHUNK_TYPE: u32 = 0x4E4F_534A;

/// The exact extension schema is intentionally preserved until a representative
/// Zoo export fixture establishes the versioned wire contract.
#[derive(Clone, Debug, PartialEq)]
pub struct RawZooExtension {
    pub value: Value,
}

#[derive(Debug, Error)]
pub enum ZooGltfError {
    #[error("input is neither glTF JSON nor a GLB 2.0 file")]
    UnsupportedContainer,
    #[error("GLB header or chunk table is truncated")]
    TruncatedGlb,
    #[error("unsupported GLB version {0}")]
    UnsupportedGlbVersion(u32),
    #[error("GLB header declares {declared} bytes but received {actual}")]
    InvalidGlbLength { declared: usize, actual: usize },
    #[error("GLB does not contain a JSON chunk")]
    MissingJsonChunk,
    #[error("invalid glTF JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("glTF does not contain `{ZOO_BREP_EXTENSION}`")]
    MissingZooExtension,
}

pub fn extract_zoo_extension(bytes: &[u8]) -> Result<RawZooExtension, ZooGltfError> {
    let document = if bytes.starts_with(GLB_MAGIC) {
        parse_glb_json(bytes)?
    } else if bytes
        .iter()
        .copied()
        .find(|byte| !byte.is_ascii_whitespace())
        == Some(b'{')
    {
        serde_json::from_slice(bytes)?
    } else {
        return Err(ZooGltfError::UnsupportedContainer);
    };

    let value = document
        .get("extensions")
        .and_then(|extensions| extensions.get(ZOO_BREP_EXTENSION))
        .cloned()
        .ok_or(ZooGltfError::MissingZooExtension)?;

    Ok(RawZooExtension { value })
}

fn parse_glb_json(bytes: &[u8]) -> Result<Value, ZooGltfError> {
    if bytes.len() < 12 {
        return Err(ZooGltfError::TruncatedGlb);
    }

    let version = read_u32(bytes, 4)?;
    if version != GLB_VERSION_2 {
        return Err(ZooGltfError::UnsupportedGlbVersion(version));
    }

    let declared = read_u32(bytes, 8)? as usize;
    if declared != bytes.len() {
        return Err(ZooGltfError::InvalidGlbLength {
            declared,
            actual: bytes.len(),
        });
    }

    let mut offset = 12;
    while offset < bytes.len() {
        let chunk_length = read_u32(bytes, offset)? as usize;
        let chunk_type = read_u32(bytes, offset + 4)?;
        let data_start = offset.checked_add(8).ok_or(ZooGltfError::TruncatedGlb)?;
        let data_end = data_start
            .checked_add(chunk_length)
            .filter(|end| *end <= bytes.len())
            .ok_or(ZooGltfError::TruncatedGlb)?;

        if chunk_type == JSON_CHUNK_TYPE {
            return Ok(serde_json::from_slice(&bytes[data_start..data_end])?);
        }
        offset = data_end;
    }

    Err(ZooGltfError::MissingJsonChunk)
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ZooGltfError> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or(ZooGltfError::TruncatedGlb)?;
    Ok(u32::from_le_bytes(
        value.try_into().expect("four-byte slice"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_extension_from_gltf_json() {
        let input = br#"{
            "asset": {"version": "2.0"},
            "extensions": {
                "KITTYCAD_boundary_representation": {"solids": [1, 2]}
            }
        }"#;

        assert_eq!(
            extract_zoo_extension(input).unwrap().value,
            json!({"solids": [1, 2]})
        );
    }

    #[test]
    fn extracts_extension_from_glb() {
        let json = br#"{"asset":{"version":"2.0"},"extensions":{"KITTYCAD_boundary_representation":{"faces":6}}}"#;
        let glb = make_glb(json);

        assert_eq!(
            extract_zoo_extension(&glb).unwrap().value,
            json!({"faces": 6})
        );
    }

    #[test]
    fn rejects_incorrect_declared_length() {
        let mut glb = make_glb(br#"{"asset":{"version":"2.0"}}"#);
        glb[8..12].copy_from_slice(&12_u32.to_le_bytes());

        assert!(matches!(
            extract_zoo_extension(&glb),
            Err(ZooGltfError::InvalidGlbLength { .. })
        ));
    }

    fn make_glb(json: &[u8]) -> Vec<u8> {
        let padded_length = (json.len() + 3) & !3;
        let total_length = 12 + 8 + padded_length;
        let mut glb = Vec::with_capacity(total_length);
        glb.extend_from_slice(GLB_MAGIC);
        glb.extend_from_slice(&GLB_VERSION_2.to_le_bytes());
        glb.extend_from_slice(&(total_length as u32).to_le_bytes());
        glb.extend_from_slice(&(padded_length as u32).to_le_bytes());
        glb.extend_from_slice(&JSON_CHUNK_TYPE.to_le_bytes());
        glb.extend_from_slice(json);
        glb.resize(total_length, b' ');
        glb
    }
}
