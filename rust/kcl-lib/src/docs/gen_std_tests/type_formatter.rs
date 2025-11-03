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
    if s.contains(" | ") {
        let mut parts = Vec::new();
        for or_clause in s.split(" | ") {
            parts.push(parse(or_clause)?);
        }
        return Ok(KclType::Union { variants: parts });
    }

    // Atom case
    Ok(KclType::Atom(s))
}

#[cfg(test)]
mod tests {
    use super::*;
    use Cardinality::*;
    use KclType::*;

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
