use divan::{Bencher, black_box};
use kcl_ezpz::{
    Constraint, Id,
    datatypes::{DatumPoint, LineSegment},
    solve,
};
use newton_faer::init_global_parallelism;

fn main() {
    // Run registered benchmarks.
    divan::main();
}

#[divan::bench(args = [0, 1, 8])]
fn id_generation(point_id: usize) -> Id {
    let entity_id = black_box(Id::new_entity('a'));
    let p0_id = black_box(entity_id.child_point(point_id));
    black_box(p0_id.child_x_component())
}

#[divan::bench]
fn bench_solve_easy(bencher: Bencher) {
    init_global_parallelism(1);
    let p = DatumPoint::new(Id::new_point('p'));
    let q = DatumPoint::new(Id::new_point('q'));

    bencher.bench_local(move || {
        let initial_guesses = vec![
            // px and py
            (p.id_x(), 0.0),
            (p.id_y(), 0.0),
            // qx and qy
            (q.id_x(), 0.01),
            (q.id_y(), 9.0),
        ];
        let _actual = black_box(
            solve(
                vec![
                    Constraint::Vertical(p, q),
                    Constraint::Fixed(p.id_x(), 0.0),
                    Constraint::Fixed(p.id_y(), 0.0),
                    Constraint::Fixed(q.id_y(), 9.0),
                ],
                initial_guesses,
            )
            .unwrap(),
        );
    })
}

#[divan::bench]
fn bench_solve_rectangle(bencher: Bencher) {
    init_global_parallelism(1);
    let p0 = DatumPoint::new(Id::new_point('p'));
    let p1 = DatumPoint::new(Id::new_point('q'));
    let p2 = DatumPoint::new(Id::new_point('r'));
    let p3 = DatumPoint::new(Id::new_point('s'));
    let line0_bottom = LineSegment {
        id: Id::new_entity('a'),
        p0,
        p1,
    };
    let line0_right = LineSegment {
        id: Id::new_entity('b'),
        p0: p1,
        p1: p2,
    };
    let line0_top = LineSegment {
        id: Id::new_entity('c'),
        p0: p2,
        p1: p3,
    };
    let line0_left = LineSegment {
        id: Id::new_entity('d'),
        p0: p3,
        p1: p0,
    };
    // Second square (upper case IDs)
    let p4 = DatumPoint::new(Id::new_point('P'));
    let p5 = DatumPoint::new(Id::new_point('Q'));
    let p6 = DatumPoint::new(Id::new_point('R'));
    let p7 = DatumPoint::new(Id::new_point('S'));
    let line1_bottom = LineSegment {
        id: Id::new_entity('A'),
        p0: p4,
        p1: p5,
    };
    let line1_right = LineSegment {
        id: Id::new_entity('B'),
        p0: p5,
        p1: p6,
    };
    let line1_top = LineSegment {
        id: Id::new_entity('C'),
        p0: p6,
        p1: p7,
    };
    let line1_left = LineSegment {
        id: Id::new_entity('D'),
        p0: p7,
        p1: p4,
    };
    // First square (lower case IDs)
    let constraints0 = vec![
        Constraint::PointFixed(p0, 1.0, 1.0),
        Constraint::Horizontal(line0_bottom.p0, line0_bottom.p1),
        Constraint::Horizontal(line0_top.p0, line0_top.p1),
        Constraint::Vertical(line0_left.p0, line0_left.p1),
        Constraint::Vertical(line0_right.p0, line0_right.p1),
        Constraint::Distance(p0, p1, 4.0),
        Constraint::Distance(p0, p3, 3.0),
    ];

    // Start p at the origin, and q at (1,9)
    let initial_guesses = vec![
        // First square.
        (p0.id_x(), 1.0),
        (p0.id_y(), 1.0),
        (p1.id_x(), 4.5),
        (p1.id_y(), 1.5),
        (p2.id_x(), 4.0),
        (p2.id_y(), 3.5),
        (p3.id_x(), 1.5),
        (p3.id_y(), 3.0),
        // Second square.
        (p4.id_x(), 2.0),
        (p4.id_y(), 2.0),
        (p5.id_x(), 5.5),
        (p5.id_y(), 3.5),
        (p6.id_x(), 5.0),
        (p6.id_y(), 4.5),
        (p7.id_x(), 2.5),
        (p7.id_y(), 4.0),
    ];

    let constraints1 = vec![
        Constraint::PointFixed(p4, 2.0, 2.0),
        Constraint::Horizontal(line1_bottom.p0, line1_bottom.p1),
        Constraint::Horizontal(line1_top.p0, line1_top.p1),
        Constraint::Vertical(line1_left.p0, line1_left.p1),
        Constraint::Vertical(line1_right.p0, line1_right.p1),
        Constraint::Distance(p4, p5, 4.0),
        Constraint::Distance(p4, p7, 4.0),
    ];

    let mut constraints = constraints0;
    constraints.extend(constraints1);
    bencher.bench_local(move || {
        let _actual = black_box(solve(constraints.clone(), initial_guesses.clone()).unwrap());
    });
}
