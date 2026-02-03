use crate::docs::kcl_doc::{DocData, ModData};

#[derive(Debug, Eq, PartialEq)]
pub enum KclType<'i> {
    Array {
        element: Box<KclType<'i>>,
        cardinality: Cardinality,
    },
    Union {
        variants: Vec<KclType<'i>>,
    },
    Atom(&'i str),
}

#[derive(Debug, Eq, PartialEq)]
pub enum Cardinality {
    Exactly(usize),
    AtLeast(usize),
    Any,
}

impl<'i> KclType<'i> {
    pub fn format(self, fmt_for_text: bool, kcl_std: &ModData) -> String {
        match self {
            KclType::Array { element, cardinality } => {
                let t = element.format(fmt_for_text, kcl_std);
                let size = match cardinality {
                    Cardinality::Exactly(n) => format!("; {n}"),
                    Cardinality::AtLeast(n) => format!("; {n}+"),
                    Cardinality::Any => String::new(),
                };
                format!("[{t}{size}]")
            }
            KclType::Union { variants } => {
                let parts: Vec<_> = variants.into_iter().map(|v| v.format(fmt_for_text, kcl_std)).collect();
                parts.join(if fmt_for_text { " or " } else { " | " })
            }
            KclType::Atom(ty) => {
                let ty = ty.trim();
                // TODO markdown links in code blocks are not turned into links by our website stack.
                // If we can handle signatures more manually we could get highlighting and links and
                // we might want to restore the links by not checking `fmt_for_text` here.
                if fmt_for_text {
                    if ty.starts_with("number") {
                        format!("[`{ty}`](/docs/kcl-std/types/std-types-number)")
                    } else if ty.starts_with("fn") {
                        format!("[`{ty}`](/docs/kcl-std/types/std-types-fn)")
                    // Special case for `tag` because it exists as a type but is deprecated and mostly used as an arg name
                    } else if matches!(kcl_std.find_by_name(ty), Some(DocData::Ty(_))) && ty != "tag" {
                        format!("[`{ty}`](/docs/kcl-std/types/std-types-{ty})")
                    } else {
                        ty.to_owned()
                    }
                } else {
                    ty.to_string()
                }
            }
        }
    }
}

/// Parse a KCL type from its typical string representation in KCL source code.
pub fn parse<'i>(s: &'i str) -> anyhow::Result<KclType<'i>> {
    // Array case
    if let Some(s2) = s.strip_prefix('[')
        && let Some(inner) = s2.strip_suffix(']')
    {
        // Arrays with cardinality
        let ends_with_digit = inner.ends_with(|ch: char| ch == '+' || ch.is_ascii_digit());
        if ends_with_digit && let Some((element_str, cardinality_str)) = inner.rsplit_once("; ") {
            let cardinality = if let Some(num_str) = cardinality_str.strip_suffix('+') {
                let n = num_str.parse()?;
                Cardinality::AtLeast(n)
            } else {
                let n = cardinality_str.parse()?;
                Cardinality::Exactly(n)
            };
            let element = parse(element_str).map(Box::new)?;
            return Ok(KclType::Array { element, cardinality });
        }

        // Arrays with no cardinality
        let element = parse(inner).map(Box::new)?;
        return Ok(KclType::Array {
            element,
            cardinality: Cardinality::Any,
        });
    }

    // Union case
    if let Some(parts) = split_top_level_union(s)? {
        let mut variants = Vec::with_capacity(parts.len());
        for clause in parts {
            variants.push(parse(clause)?);
        }
        return Ok(KclType::Union { variants });
    }

    // Atom case
    Ok(KclType::Atom(s))
}

/// If this was a type union, return Ok(Some(parts))
/// If it's a normal atomic type, return Ok(None)
fn split_top_level_union(s: &str) -> anyhow::Result<Option<Vec<&str>>> {
    let mut parts = Vec::new();
    let mut depth = 0;
    let mut start_of_part = 0;
    let bytes = s.as_bytes();
    let mut i = 0;
    let divider = b" | ";
    let divider_len = divider.len();

    while i < bytes.len() {
        match bytes[i] {
            b'[' => {
                depth += 1;
                i += 1;
            }
            b']' => {
                if depth == 0 {
                    anyhow::bail!("Unexpected ] without matching [");
                }
                depth -= 1;
                i += 1;
            }
            _ => {
                if depth == 0 && bytes[i..].starts_with(divider) {
                    let part = s[start_of_part..i].trim();
                    if !part.is_empty() {
                        parts.push(part);
                    }
                    i += divider_len;
                    start_of_part = i;
                } else {
                    i += 1;
                }
            }
        }
    }

    if depth != 0 {
        anyhow::bail!("Unclosed [");
    }

    let tail = s[start_of_part..].trim();
    if !tail.is_empty() {
        parts.push(tail);
    }

    Ok(if parts.len() > 1 { Some(parts) } else { None })
}

#[cfg(test)]
mod tests {
    use Cardinality::*;
    use KclType::*;

    use super::*;

    #[test]
    fn test_type_formatter() {
        struct Test {
            input: &'static str,
            expected: KclType<'static>,
        }
        let tests = [
            Test {
                input: "[[Solid; 2]]",
                expected: Array {
                    element: Box::new(Array {
                        element: Box::new(Atom("Solid")),
                        cardinality: Exactly(2),
                    }),
                    cardinality: Any,
                },
            },
            Test {
                input: "[Solid; 1+]",
                expected: Array {
                    element: Box::new(Atom("Solid")),
                    cardinality: AtLeast(1),
                },
            },
            Test {
                input: "[Solid; 1+] | ImportedGeometry",
                expected: Union {
                    variants: vec![
                        Array {
                            element: Box::new(Atom("Solid")),
                            cardinality: AtLeast(1),
                        },
                        Atom("ImportedGeometry"),
                    ],
                },
            },
            Test {
                input: "[Solid | Sketch; 1+]",
                expected: Array {
                    element: Box::new(Union {
                        variants: vec![Atom("Solid"), Atom("Sketch")],
                    }),
                    cardinality: AtLeast(1),
                },
            },
            Test {
                input: "[Solid | Sketch; 1+] | ImportedGeometry",
                expected: Union {
                    variants: vec![
                        Array {
                            element: Box::new(Union {
                                variants: vec![Atom("Solid"), Atom("Sketch")],
                            }),
                            cardinality: AtLeast(1),
                        },
                        Atom("ImportedGeometry"),
                    ],
                },
            },
        ];

        for (i, test) in tests.into_iter().enumerate() {
            let actual = parse(test.input);
            match actual {
                Ok(actual) => pretty_assertions::assert_eq!(actual, test.expected),
                Err(e) => panic!("Failed test {i}: {e}"),
            }
        }
    }
}
