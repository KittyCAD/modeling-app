//! Functions for generating docs for our stdlib functions.

#[cfg(test)]
mod gen_std_tests;
pub mod kcl_doc;

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use crate::docs::kcl_doc::{self, DocData};

    #[test]
    fn get_autocomplete_snippet_line() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("line").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"line(end = [${0:0}, ${1:0}])"#);
    }

    #[test]
    fn get_autocomplete_snippet_extrude() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("extrude").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"extrude(length = ${0:10})"#);
    }

    #[test]
    fn get_autocomplete_snippet_fillet() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(fillet_fn) = data.find_by_name("fillet").unwrap() else {
            panic!();
        };
        let snippet = fillet_fn.to_autocomplete_snippet();
        assert_eq!(snippet, r#"fillet(radius = ${0:10}, tags = [${1:tag_or_edge_fn}])"#);
    }

    #[test]
    fn get_autocomplete_snippet_start_sketch_on() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("startSketchOn").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"startSketchOn(${0:XY})"#);
    }

    #[test]
    fn get_autocomplete_snippet_start_profile() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("startProfile").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"startProfile(at = [${0:0}, ${1:0}])"#);
    }

    #[test]
    fn get_autocomplete_snippet_pattern_circular_3d() {
        // We test this one specifically because it has ints and floats and strings.
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("patternCircular3d").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(
            snippet,
            r#"patternCircular3d(instances = ${0:10}, axis = [${1:1}, ${2:0}, ${3:0}], center = [${4:0}, ${5:0}, ${6:0}])"#
        );
    }

    #[test]
    fn get_autocomplete_snippet_revolve() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(revolve_fn) = data.find_by_name("revolve").unwrap() else {
            panic!();
        };
        let snippet = revolve_fn.to_autocomplete_snippet();
        assert_eq!(snippet, r#"revolve(axis = ${0:X})"#);
    }

    #[test]
    fn get_autocomplete_snippet_circle() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(circle_fn) = data.find_by_name("circle").unwrap() else {
            panic!();
        };
        let snippet = circle_fn.to_autocomplete_snippet();
        assert_eq!(
            snippet, r#"circle(center = [${0:0}, ${1:0}], diameter = ${2:10})"#,
            "actual = left, expected = right"
        );
    }

    #[test]
    fn get_autocomplete_snippet_arc() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("arc").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(
            snippet,
            r#"arc(angleStart = ${0:10}, angleEnd = ${1:10}, diameter = ${2:10})"#
        );
    }

    #[test]
    fn get_autocomplete_snippet_map() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(map_fn) = data.find_by_name("map").unwrap() else {
            panic!();
        };
        let snippet = map_fn.to_autocomplete_snippet();
        assert_eq!(snippet, r#"map()"#);
    }

    #[test]
    fn get_autocomplete_snippet_pattern_linear_2d() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("patternLinear2d").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(
            snippet,
            r#"patternLinear2d(instances = ${0:10}, distance = ${1:10}, axis = [${2:1}, ${3:0}])"#
        );
    }

    #[test]
    fn get_autocomplete_snippet_appearance() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(helix_fn) = data.find_by_name("appearance").unwrap() else {
            panic!();
        };
        let snippet = helix_fn.to_autocomplete_snippet();
        assert_eq!(snippet, "appearance(color = ${0:\"#ff0000\"})");
    }

    #[test]
    fn get_autocomplete_snippet_loft() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("loft").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"loft([${0:sketch000}, ${1:sketch001}])"#);
    }

    #[test]
    fn get_autocomplete_snippet_sweep() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("sweep").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"sweep(path = ${0:sketch000})"#);
    }

    #[test]
    fn get_autocomplete_snippet_helix() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(helix_fn) = data.find_by_name("helix").unwrap() else {
            panic!();
        };
        let snippet = helix_fn.to_autocomplete_snippet();
        assert_eq!(
            snippet,
            r#"helix(revolutions = ${0:10}, angleStart = ${1:10}, radius = ${2:10}, axis = ${3:X}, length = ${4:10})"#
        );
    }

    #[test]
    fn get_autocomplete_snippet_union() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("union").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"union([${0:extrude001}, ${1:extrude002}])"#);
    }

    #[test]
    fn get_autocomplete_snippet_subtract() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("subtract").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"subtract([${0:extrude001}], tools = [${1:extrude002}])"#);
    }

    #[test]
    fn get_autocomplete_snippet_intersect() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("intersect").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"intersect([${0:extrude001}, ${1:extrude002}])"#);
    }

    #[test]
    fn get_autocomplete_snippet_get_common_edge() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("getCommonEdge").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"getCommonEdge(faces = [${0:tag}, ${1:tag}])"#);
    }

    #[test]
    fn get_autocomplete_snippet_scale() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("scale").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"scale(x = ${0:10}, y = ${1:10}, z = ${2:10})"#);
    }

    #[test]
    fn get_autocomplete_snippet_translate() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("translate").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"translate(x = ${0:10}, y = ${1:10}, z = ${2:10})"#);
    }

    #[test]
    fn get_autocomplete_snippet_rotate() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("rotate").unwrap() else {
            panic!();
        };
        let snippet = data.to_autocomplete_snippet();
        assert_eq!(snippet, r#"rotate(roll = ${0:10}, pitch = ${1:10}, yaw = ${2:10})"#);
    }

    #[test]
    #[allow(clippy::literal_string_with_formatting_args)]
    fn get_autocomplete_snippet_clone() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(clone_fn) = data.find_by_name("clone").unwrap() else {
            panic!();
        };
        let snippet = clone_fn.to_autocomplete_snippet();
        assert_eq!(snippet, r#"clone(${0:part001})"#);
    }

    #[test]
    fn get_autocomplete_snippet_offset_plane() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(offset_plane_fn) = data.find_by_name("offsetPlane").unwrap() else {
            panic!();
        };
        let snippet = offset_plane_fn.to_autocomplete_snippet();
        assert_eq!(snippet, r#"offsetPlane(${0:XY}, offset = ${1:10})"#);
    }

    #[test]
    fn get_extrude_signature_help() {
        let data = kcl_doc::walk_prelude();
        let DocData::Fn(data) = data.find_by_name("extrude").unwrap() else {
            panic!();
        };
        let sh = data.to_signature_help();
        assert_eq!(
            sh.signatures[0].label,
            r#"extrude(
  @sketches: [Sketch; 1+],
  length: number(Length),
  symmetric?: bool,
  bidirectionalLength?: number(Length),
  tagStart?: TagDecl,
  tagEnd?: TagDecl,
  twistAngle?: number(Angle),
  twistAngleStep?: number(Angle),
  twistCenter?: Point2d,
): [Solid; 1+]"#
        );
    }
}
