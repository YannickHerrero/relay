//! Subsequence matching with bonuses for consecutive characters and word
//! starts, like the launchers this mimics.

/// Score of `query` against `text`, higher is better; `None` when the query
/// is not a subsequence. An empty query matches everything with 0.
pub fn score(query: &str, text: &str) -> Option<i32> {
    let query: Vec<char> = query.chars().flat_map(char::to_lowercase).collect();
    if query.is_empty() {
        return Some(0);
    }
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars.iter().flat_map(|c| c.to_lowercase()).collect();
    if lower.len() != chars.len() {
        // Case folding changed the length; match on the folded text only.
        return simple(&query, &lower);
    }
    let mut score = 0;
    let mut qi = 0;
    let mut previous: Option<usize> = None;
    for (i, c) in lower.iter().enumerate() {
        if qi == query.len() {
            break;
        }
        if *c != query[qi] {
            continue;
        }
        score += 1;
        let word_start = i == 0
            || !chars[i - 1].is_alphanumeric()
            || (chars[i].is_uppercase() && chars[i - 1].is_lowercase());
        if word_start {
            score += 8;
        }
        if previous == Some(i.wrapping_sub(1)) {
            score += 5;
        }
        if i == 0 {
            score += 4;
        }
        previous = Some(i);
        qi += 1;
    }
    (qi == query.len()).then(|| score - (lower.len() as i32 / 8))
}

fn simple(query: &[char], text: &[char]) -> Option<i32> {
    let mut it = text.iter();
    query.iter().all(|q| it.any(|c| c == q)).then_some(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subsequence_matches() {
        assert!(score("nt", "New terminal").is_some());
        assert!(score("xyz", "New terminal").is_none());
        assert_eq!(score("", "anything"), Some(0));
    }

    #[test]
    fn word_starts_beat_scattered_letters() {
        let starts = score("nt", "New terminal").unwrap();
        let scattered = score("nt", "Fullscreen tile").unwrap();
        assert!(starts > scattered);
    }

    #[test]
    fn consecutive_beats_split() {
        assert!(score("rel", "relay").unwrap() > score("rel", "rxexl").unwrap());
    }
}
