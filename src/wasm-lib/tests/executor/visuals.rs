macro_rules! kcl_input {
    ($file:literal) => {
        include_str!(concat!("inputs/", $file, ".kcl"))
    };
}

macro_rules! kcl_test {
    ($file:literal, $test_name:ident) => {
        #[tokio::test(flavor = "multi_thread")]
        async fn $test_name() {
            let code = kcl_input!($file);

            let result = super::execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
                .await
                .unwrap();
            super::assert_out($file, &result);
        }
    };
}

kcl_test!("sketch_on_face", kcl_test_sketch_on_face);
kcl_test!("poop_chute", kcl_test_poop_chute);
kcl_test!("neg_xz_plane", kcl_test_neg_xz_plane);
kcl_test!("xz_plane", kcl_test_xz_plane);
kcl_test!(
    "sketch_on_face_after_fillets_referencing_face",
    kcl_test_sketch_on_face_after_fillets_referencing_face
);
kcl_test!("circular_pattern3d_a_pattern", kcl_test_circular_pattern3d_a_pattern);
kcl_test!("linear_pattern3d_a_pattern", kcl_test_linear_pattern3d_a_pattern);

kcl_test!("tangential_arc", kcl_test_tangential_arc);
kcl_test!(
    "big_number_angle_to_match_length_x",
    kcl_test_big_number_angle_to_match_length_x
);
kcl_test!(
    "big_number_angle_to_match_length_y",
    kcl_test_big_number_angle_to_match_length_y
);
kcl_test!("sketch_on_face_circle_tagged", kcl_test_sketch_on_face_circle_tagged);
kcl_test!("basic_fillet_cube_start", kcl_test_basic_fillet_cube_start);
kcl_test!(
    "basic_fillet_cube_next_adjacent",
    kcl_test_basic_fillet_cube_next_adjacent
);
kcl_test!(
    "basic_fillet_cube_previous_adjacent",
    kcl_test_basic_fillet_cube_previous_adjacent
);
kcl_test!("basic_fillet_cube_end", kcl_test_basic_fillet_cube_end);
kcl_test!(
    "basic_fillet_cube_close_opposite",
    kcl_test_basic_fillet_cube_close_opposite
);
kcl_test!("sketch_on_face_end", kcl_test_sketch_on_face_end);
kcl_test!("sketch_on_face_start", kcl_test_sketch_on_face_start);
kcl_test!(
    "sketch_on_face_end_negative_extrude",
    kcl_test_sketch_on_face_end_negative_extrude
);
kcl_test!("mike_stress_test", kcl_test_mike_stress_test);
kcl_test!("pentagon_fillet_sugar", kcl_test_pentagon_fillet_sugar);
kcl_test!("pipe_as_arg", kcl_test_pipe_as_arg);
kcl_test!("computed_var", kcl_test_computed_var);
kcl_test!("lego", kcl_test_lego);
kcl_test!("riddle_small", kcl_test_riddle_small);
kcl_test!("tan_arc_x_line", kcl_test_tan_arc_x_line);
kcl_test!("fillet-and-shell", kcl_test_fillet_and_shell);
kcl_test!("sketch-on-chamfer-two-times", kcl_test_sketch_on_chamfer_two_times);
kcl_test!(
    "sketch-on-chamfer-two-times-different-order",
    kcl_test_sketch_on_chamfer_two_times_different_order
);
