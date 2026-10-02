use ratatui::layout::Rect;

/// Smallest window, border included, that a split may produce.
pub const MIN_WIDTH: u16 = 12;
pub const MIN_HEIGHT: u16 = 5;

pub const DEFAULT_RATIO: f32 = 0.5;
const MIN_RATIO: f32 = 0.1;
const MAX_RATIO: f32 = 0.9;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Left,
    Right,
    Up,
    Down,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    /// Cut by a vertical line: windows side by side.
    Vertical,
    /// Cut by a horizontal line: windows stacked.
    Horizontal,
}

/// One split of the fibonacci spiral: window `level` takes `first`, the
/// windows after it share `second`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Split {
    pub level: usize,
    pub axis: Axis,
    pub area: Rect,
    pub first: Rect,
    pub second: Rect,
}

/// Fibonacci tiling: the first window takes the left part, each following
/// window splits what remains, alternating vertical and horizontal cuts.
/// `ratios[i]` is the share window `i` takes of the area it splits.
pub fn fibonacci(area: Rect, count: usize, ratios: &[f32]) -> Vec<Rect> {
    let (rects, _) = fibonacci_with_splits(area, count, ratios);
    rects
}

pub fn fibonacci_with_splits(area: Rect, count: usize, ratios: &[f32]) -> (Vec<Rect>, Vec<Split>) {
    let mut rects = Vec::with_capacity(count);
    let mut splits = Vec::new();
    let mut remaining = area;
    for level in 0..count {
        if level == count - 1 {
            rects.push(remaining);
            break;
        }
        let preferred = if level % 2 == 0 {
            Axis::Vertical
        } else {
            Axis::Horizontal
        };
        let ratio = ratios.get(level).copied().unwrap_or(DEFAULT_RATIO);
        let axis = [preferred, other(preferred)]
            .into_iter()
            .find(|axis| can_split(remaining, *axis));
        let Some(axis) = axis else {
            // Too small to split again: the rest stack on the same area.
            rects.extend(std::iter::repeat_n(remaining, count - level));
            break;
        };
        let (first, second) = cut(remaining, axis, ratio);
        splits.push(Split {
            level,
            axis,
            area: remaining,
            first,
            second,
        });
        rects.push(first);
        remaining = second;
    }
    (rects, splits)
}

fn other(axis: Axis) -> Axis {
    match axis {
        Axis::Vertical => Axis::Horizontal,
        Axis::Horizontal => Axis::Vertical,
    }
}

fn can_split(area: Rect, axis: Axis) -> bool {
    match axis {
        Axis::Vertical => area.width >= MIN_WIDTH * 2,
        Axis::Horizontal => area.height >= MIN_HEIGHT * 2,
    }
}

fn cut(area: Rect, axis: Axis, ratio: f32) -> (Rect, Rect) {
    let ratio = ratio.clamp(MIN_RATIO, MAX_RATIO);
    match axis {
        Axis::Vertical => {
            let w = ((area.width as f32 * ratio).round() as u16)
                .clamp(MIN_WIDTH, area.width - MIN_WIDTH);
            (
                Rect::new(area.x, area.y, w, area.height),
                Rect::new(area.x + w, area.y, area.width - w, area.height),
            )
        }
        Axis::Horizontal => {
            let h = ((area.height as f32 * ratio).round() as u16)
                .clamp(MIN_HEIGHT, area.height - MIN_HEIGHT);
            (
                Rect::new(area.x, area.y, area.width, h),
                Rect::new(area.x, area.y + h, area.width, area.height - h),
            )
        }
    }
}

/// The ratio that puts a split boundary at `position` (a column for a
/// vertical cut, a row for a horizontal one).
pub fn ratio_at(split: &Split, position: u16) -> f32 {
    let (start, len) = match split.axis {
        Axis::Vertical => (split.area.x, split.area.width),
        Axis::Horizontal => (split.area.y, split.area.height),
    };
    let offset = position.saturating_sub(start) as f32;
    (offset / len as f32).clamp(MIN_RATIO, MAX_RATIO)
}

/// Geometrically nearest rectangle in `dir` from `from`, penalizing
/// perpendicular distance. Returns the index into `rects`.
pub fn neighbor(rects: &[Rect], from: usize, dir: Direction) -> Option<usize> {
    let cur = rects.get(from)?;
    rects
        .iter()
        .enumerate()
        .filter(|(i, r)| *i != from && **r != *cur)
        .filter_map(|(i, r)| {
            let (gap, perpendicular) = match dir {
                Direction::Left if r.right() <= cur.x => (
                    cur.x - r.right(),
                    overlap_gap(r.y, r.bottom(), cur.y, cur.bottom()),
                ),
                Direction::Right if r.x >= cur.right() => (
                    r.x - cur.right(),
                    overlap_gap(r.y, r.bottom(), cur.y, cur.bottom()),
                ),
                Direction::Up if r.bottom() <= cur.y => (
                    cur.y - r.bottom(),
                    overlap_gap(r.x, r.right(), cur.x, cur.right()),
                ),
                Direction::Down if r.y >= cur.bottom() => (
                    r.y - cur.bottom(),
                    overlap_gap(r.x, r.right(), cur.x, cur.right()),
                ),
                _ => return None,
            };
            Some((
                i,
                gap as u32 + 2 * perpendicular as u32,
                center_distance(cur, r),
            ))
        })
        .min_by_key(|(_, score, tie)| (*score, *tie))
        .map(|(i, _, _)| i)
}

fn overlap_gap(a0: u16, a1: u16, b0: u16, b1: u16) -> u16 {
    b0.saturating_sub(a1).max(a0.saturating_sub(b1))
}

fn center_distance(a: &Rect, b: &Rect) -> u32 {
    let ax = a.x as i32 * 2 + a.width as i32;
    let ay = a.y as i32 * 2 + a.height as i32;
    let bx = b.x as i32 * 2 + b.width as i32;
    let by = b.y as i32 * 2 + b.height as i32;
    (ax - bx).unsigned_abs() + (ay - by).unsigned_abs()
}

/// Grows (positive `delta`) or shrinks window `index` along `axis` by moving
/// the nearest split that bounds it. Returns false when no split does.
pub fn resize(
    splits: &[Split],
    ratios: &mut Vec<f32>,
    index: usize,
    axis: Axis,
    delta: f32,
) -> bool {
    let Some(split) = splits
        .iter()
        .filter(|s| s.axis == axis && s.level <= index)
        .max_by_key(|s| s.level)
    else {
        return false;
    };
    if ratios.len() <= split.level {
        ratios.resize(split.level + 1, DEFAULT_RATIO);
    }
    let ratio = &mut ratios[split.level];
    // Window `level` is the first part; later windows live in the second.
    let signed = if split.level == index { delta } else { -delta };
    *ratio = (*ratio + signed).clamp(MIN_RATIO, MAX_RATIO);
    true
}

/// Moves one edge of window `index` by `step` toward `dir`: the edge on
/// that side when it is a split boundary, else the opposite one. So the key
/// pointing at a neighbor grows the window, the other shrinks it.
pub fn move_edge(
    splits: &[Split],
    rects: &[Rect],
    ratios: &mut Vec<f32>,
    index: usize,
    dir: Direction,
    step: f32,
) -> bool {
    let Some(rect) = rects.get(index) else {
        return false;
    };
    let (axis, toward_start) = match dir {
        Direction::Left => (Axis::Vertical, true),
        Direction::Right => (Axis::Vertical, false),
        Direction::Up => (Axis::Horizontal, true),
        Direction::Down => (Axis::Horizontal, false),
    };
    // A window's start edge is the cut of an earlier split whose second
    // part it begins; its end edge is the cut of its own split.
    let start_edge = || {
        splits
            .iter()
            .filter(|s| s.axis == axis && s.level < index)
            .filter(|s| match axis {
                Axis::Vertical => s.second.x == rect.x,
                Axis::Horizontal => s.second.y == rect.y,
            })
            .max_by_key(|s| s.level)
    };
    let end_edge = || splits.iter().find(|s| s.axis == axis && s.level == index);
    let split = if toward_start {
        start_edge().or_else(end_edge)
    } else {
        end_edge().or_else(start_edge)
    };
    let Some(split) = split else {
        return false;
    };
    if ratios.len() <= split.level {
        ratios.resize(split.level + 1, DEFAULT_RATIO);
    }
    let ratio = &mut ratios[split.level];
    let delta = if toward_start { -step } else { step };
    *ratio = (*ratio + delta).clamp(MIN_RATIO, MAX_RATIO);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect::new(0, 0, 100, 40);

    #[test]
    fn single_window_takes_everything() {
        assert_eq!(fibonacci(AREA, 1, &[]), vec![AREA]);
    }

    #[test]
    fn two_windows_split_left_right() {
        assert_eq!(
            fibonacci(AREA, 2, &[]),
            vec![Rect::new(0, 0, 50, 40), Rect::new(50, 0, 50, 40)]
        );
    }

    #[test]
    fn third_window_splits_the_right_half_vertically() {
        assert_eq!(
            fibonacci(AREA, 3, &[]),
            vec![
                Rect::new(0, 0, 50, 40),
                Rect::new(50, 0, 50, 20),
                Rect::new(50, 20, 50, 20),
            ]
        );
    }

    #[test]
    fn fourth_window_alternates_back_to_side_by_side() {
        let rects = fibonacci(AREA, 4, &[]);
        assert_eq!(rects[2], Rect::new(50, 20, 25, 20));
        assert_eq!(rects[3], Rect::new(75, 20, 25, 20));
    }

    #[test]
    fn tiny_remainder_stacks_instead_of_splitting() {
        let rects = fibonacci(Rect::new(0, 0, 30, 8), 4, &[]);
        assert_eq!(rects.len(), 4);
        assert_eq!(rects[2], rects[3]);
    }

    #[test]
    fn ratios_move_the_split() {
        let rects = fibonacci(AREA, 2, &[0.7]);
        assert_eq!(rects[0].width, 70);
    }

    #[test]
    fn neighbor_finds_adjacent_windows() {
        let rects = fibonacci(AREA, 3, &[]);
        assert_eq!(neighbor(&rects, 0, Direction::Right), Some(1));
        assert_eq!(neighbor(&rects, 2, Direction::Up), Some(1));
        assert_eq!(neighbor(&rects, 2, Direction::Left), Some(0));
        assert_eq!(neighbor(&rects, 0, Direction::Left), None);
    }

    #[test]
    fn resize_first_window_moves_its_own_split() {
        let (_, splits) = fibonacci_with_splits(AREA, 2, &[]);
        let mut ratios = vec![];
        assert!(resize(&splits, &mut ratios, 0, Axis::Vertical, 0.05));
        assert!((ratios[0] - 0.55).abs() < 1e-6);
    }

    #[test]
    fn resize_later_window_shrinks_the_enclosing_split() {
        let (_, splits) = fibonacci_with_splits(AREA, 3, &[]);
        let mut ratios = vec![];
        assert!(resize(&splits, &mut ratios, 2, Axis::Vertical, 0.05));
        assert!((ratios[0] - 0.45).abs() < 1e-6);
    }

    #[test]
    fn resize_without_matching_split_fails() {
        let (_, splits) = fibonacci_with_splits(AREA, 2, &[]);
        let mut ratios = vec![];
        assert!(!resize(&splits, &mut ratios, 0, Axis::Horizontal, 0.05));
    }

    fn nudge(count: usize, index: usize, dir: Direction) -> Vec<f32> {
        let (rects, splits) = fibonacci_with_splits(AREA, count, &[]);
        let mut ratios = vec![];
        assert!(move_edge(&splits, &rects, &mut ratios, index, dir, 0.05));
        ratios
    }

    #[test]
    fn keys_toward_a_neighbor_grow_the_window() {
        // Right window, h: its left edge moves left.
        assert!((nudge(2, 1, Direction::Left)[0] - 0.45).abs() < 1e-6);
        // Left window, l: its right edge moves right.
        assert!((nudge(2, 0, Direction::Right)[0] - 0.55).abs() < 1e-6);
    }

    #[test]
    fn keys_away_from_a_neighbor_shrink_the_window() {
        assert!((nudge(2, 0, Direction::Left)[0] - 0.45).abs() < 1e-6);
        assert!((nudge(2, 1, Direction::Right)[0] - 0.55).abs() < 1e-6);
    }

    #[test]
    fn vertical_keys_pick_the_horizontal_cut() {
        // Bottom right window, k: its top edge moves up.
        assert!((nudge(3, 2, Direction::Up)[1] - 0.45).abs() < 1e-6);
        assert!(!move_edge(
            &[],
            &[AREA],
            &mut vec![],
            0,
            Direction::Up,
            0.05
        ));
    }

    #[test]
    fn ratio_at_maps_position_into_split_area() {
        let (_, splits) = fibonacci_with_splits(AREA, 2, &[]);
        assert!((ratio_at(&splits[0], 30) - 0.3).abs() < 1e-6);
    }
}
