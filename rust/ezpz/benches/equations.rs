use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use kcl_ezpz::{
    Constraint, IdGenerator,
    datatypes::{DatumPoint, LineSegment},
    solve,
};
use newton_faer::init_global_parallelism;

fn solve_easy(c: &mut Criterion) {
    init_global_parallelism(1);
    let mut id_generator = IdGenerator::default();
    let p = DatumPoint::new(&mut id_generator);
    let q = DatumPoint::new(&mut id_generator);
    let initial_guesses = vec![
        // px and py
        (p.id_x(), 0.0),
        (p.id_y(), 0.0),
        // qx and qy
        (q.id_x(), 0.01),
        (q.id_y(), 9.0),
    ];
    let line = LineSegment {
        p0: p,
        p1: q,
        id: id_generator.next_id(),
    };
    let constraints = vec![
        Constraint::Vertical(line),
        Constraint::Fixed(p.id_x(), 0.0),
        Constraint::Fixed(p.id_y(), 0.0),
        Constraint::Fixed(q.id_y(), 9.0),
    ];

    c.bench_function("solve easy", |b| {
        b.iter(|| {
            let _actual = black_box(solve(constraints.clone(), initial_guesses.clone()).unwrap());
        })
    });
}

fn solve_two_rectangles(c: &mut Criterion) {
    let mut id_generator = IdGenerator::default();
    init_global_parallelism(1);
    let p0 = DatumPoint::new(&mut id_generator);
    let p1 = DatumPoint::new(&mut id_generator);
    let p2 = DatumPoint::new(&mut id_generator);
    let p3 = DatumPoint::new(&mut id_generator);
    let line0_bottom = LineSegment::new(p0, p1, &mut id_generator);
    let line0_right = LineSegment::new(p1, p2, &mut id_generator);
    let line0_top = LineSegment::new(p2, p3, &mut id_generator);
    let line0_left = LineSegment::new(p3, p0, &mut id_generator);
    // Second square (upper case IDs)
    let p4 = DatumPoint::new(&mut id_generator);
    let p5 = DatumPoint::new(&mut id_generator);
    let p6 = DatumPoint::new(&mut id_generator);
    let p7 = DatumPoint::new(&mut id_generator);
    let line1_bottom = LineSegment::new(p4, p5, &mut id_generator);
    let line1_right = LineSegment::new(p5, p6, &mut id_generator);
    let line1_top = LineSegment::new(p6, p7, &mut id_generator);
    let line1_left = LineSegment::new(p7, p4, &mut id_generator);
    // First square (lower case IDs)
    let constraints0 = vec![
        Constraint::Fixed(p0.id_x(), 1.0),
        Constraint::Fixed(p0.id_y(), 1.0),
        Constraint::Horizontal(line0_bottom),
        Constraint::Horizontal(line0_top),
        Constraint::Vertical(line0_left),
        Constraint::Vertical(line0_right),
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
        Constraint::Fixed(p4.id_x(), 2.0),
        Constraint::Fixed(p4.id_y(), 2.0),
        Constraint::Horizontal(line1_bottom),
        Constraint::Horizontal(line1_top),
        Constraint::Vertical(line1_left),
        Constraint::Vertical(line1_right),
        Constraint::Distance(p4, p5, 4.0),
        Constraint::Distance(p4, p7, 4.0),
    ];

    let mut constraints = constraints0;
    constraints.extend(constraints1);
    c.bench_function("solve two rectangles", |b| {
        b.iter(|| {
            let _actual = black_box(solve(constraints.clone(), initial_guesses.clone()).unwrap());
        })
    });
}

/// Just like `solve_two_rectangles`, except that the rectangles
/// depend on each other.
fn solve_two_rectangles_dependent(c: &mut Criterion) {
    let mut id_generator = IdGenerator::default();
    init_global_parallelism(1);
    let p0 = DatumPoint::new(&mut id_generator);
    let p1 = DatumPoint::new(&mut id_generator);
    let p2 = DatumPoint::new(&mut id_generator);
    let p3 = DatumPoint::new(&mut id_generator);
    let line0_bottom = LineSegment::new(p0, p1, &mut id_generator);
    let line0_right = LineSegment::new(p1, p2, &mut id_generator);
    let line0_top = LineSegment::new(p2, p3, &mut id_generator);
    let line0_left = LineSegment::new(p3, p0, &mut id_generator);
    // Second square (upper case IDs)
    let p5 = DatumPoint::new(&mut id_generator);
    let p6 = DatumPoint::new(&mut id_generator);
    let p7 = DatumPoint::new(&mut id_generator);
    let line1_bottom = LineSegment::new(p2, p5, &mut id_generator);
    let line1_right = LineSegment::new(p5, p6, &mut id_generator);
    let line1_top = LineSegment::new(p6, p7, &mut id_generator);
    let line1_left = LineSegment::new(p7, p2, &mut id_generator);
    // First square (lower case IDs)
    let constraints0 = vec![
        Constraint::Fixed(p0.id_x(), 1.0),
        Constraint::Fixed(p0.id_y(), 1.0),
        Constraint::Horizontal(line0_bottom),
        Constraint::Horizontal(line0_top),
        Constraint::Vertical(line0_left),
        Constraint::Vertical(line0_right),
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
        (p5.id_x(), 5.5),
        (p5.id_y(), 3.5),
        (p6.id_x(), 5.0),
        (p6.id_y(), 4.5),
        (p7.id_x(), 2.5),
        (p7.id_y(), 4.0),
    ];

    let constraints1 = vec![
        Constraint::Horizontal(line1_bottom),
        Constraint::Horizontal(line1_top),
        Constraint::Vertical(line1_left),
        Constraint::Vertical(line1_right),
        Constraint::Distance(p2, p5, 4.0),
        Constraint::Distance(p2, p7, 4.0),
    ];

    let mut constraints = constraints0;
    constraints.extend(constraints1);
    c.bench_function("solve two rectangles", |b| {
        b.iter(|| {
            let _actual = black_box(solve(constraints.clone(), initial_guesses.clone()).unwrap());
        })
    });
}

criterion_group!(
    benches,
    solve_easy,
    solve_two_rectangles,
    solve_two_rectangles_dependent
);
criterion_main!(benches);
