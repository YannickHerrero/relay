//! The choice an agent waits on, read from its screen: Claude Code draws
//! permission prompts, questions and dialogs as a list with a `❯` cursor.

use serde::Serialize;

const CURSOR: char = '❯';

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Prompt {
    /// First line of the dialog: "Bash command", a question's header.
    pub title: Option<String>,
    /// What the dialog shows between its title and the choices.
    pub lines: Vec<String>,
    pub options: Vec<Choice>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Choice {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Keys that pick it: its number, or arrows to it and Enter.
    pub keys: Vec<String>,
}

fn indent(line: &str) -> usize {
    line.chars().take_while(|c| *c == ' ').count()
}

fn is_rule(line: &str, chars: &[char]) -> bool {
    let line = line.trim();
    line.chars().count() >= 3 && line.chars().all(|c| chars.contains(&c))
}

/// The prompt at the bottom of `screen`, if a list with a cursor is there.
pub fn parse(screen: &str) -> Option<Prompt> {
    // The cursor drawn as a space keeps the label column of every line.
    let lines: Vec<String> = screen.lines().map(|l| l.replacen(CURSOR, " ", 1)).collect();
    let raw: Vec<&str> = screen.lines().collect();
    let selected = raw.iter().rposition(|l| {
        l.trim_start()
            .strip_prefix(CURSOR)
            .is_some_and(|rest| !rest.trim().is_empty())
    })?;
    let column = indent(&lines[selected]);
    let starts = |i: usize| {
        let line = &lines[i];
        !line.trim().is_empty() && indent(line) == column
    };
    let continues = |i: usize| indent(&lines[i]) > column && !lines[i].trim().is_empty();
    let solid = |i: usize| is_rule(&lines[i], &['─', '━', '╌']);

    let mut first = selected;
    while first > 0 && (starts(first - 1) || continues(first - 1)) {
        first -= 1;
    }
    while first < selected && !starts(first) {
        first += 1;
    }
    let mut last = selected;
    let mut i = selected + 1;
    while i < lines.len() {
        if starts(i) || continues(i) {
            last = i;
        } else if !(solid(i) && i + 1 < lines.len() && starts(i + 1)) {
            break;
        }
        i += 1;
    }

    let mut options: Vec<(String, Vec<String>)> = Vec::new();
    for line in &lines[first..=last] {
        if solid_line(line) {
            continue;
        }
        if indent(line) == column {
            options.push((line.trim().to_owned(), Vec::new()));
        } else if let Some((_, description)) = options.last_mut() {
            description.push(line.trim().to_owned());
        }
    }
    let cursor = lines[first..selected]
        .iter()
        .filter(|l| !solid_line(l) && indent(l) == column)
        .count();
    let choices = options
        .into_iter()
        .enumerate()
        .map(|(n, (label, description))| {
            let (number, label) = numbered(&label);
            let keys = match number {
                Some(number) => vec![number],
                None => {
                    let arrow = if n >= cursor { "Down" } else { "Up" };
                    let mut keys = vec![arrow.to_owned(); n.abs_diff(cursor)];
                    keys.push("Enter".into());
                    keys
                }
            };
            Choice {
                label,
                description: (!description.is_empty()).then(|| description.join(" ")),
                keys,
            }
        })
        .collect();

    // The dialog starts after the last full rule above the list.
    let top = (0..first)
        .rev()
        .find(|i| is_rule(&lines[*i], &['─', '━']))
        .map_or(0, |i| i + 1);
    let mut body: Vec<String> = lines[top..first]
        .iter()
        .filter(|l| !is_rule(l, &['─', '━', '╌']))
        .map(|l| {
            let l = l.trim();
            l.strip_prefix('│').map_or(l, str::trim_start).to_owned()
        })
        .collect();
    while body.first().is_some_and(|l| l.is_empty()) {
        body.remove(0);
    }
    while body.last().is_some_and(|l| l.is_empty()) {
        body.pop();
    }
    let title = (!body.is_empty()).then(|| {
        let title = body.remove(0);
        title
            .trim_start_matches(|c: char| !c.is_alphanumeric())
            .to_owned()
    });
    while body.first().is_some_and(|l| l.is_empty()) {
        body.remove(0);
    }
    Some(Prompt {
        title,
        lines: body,
        options: choices,
    })
}

fn solid_line(line: &str) -> bool {
    is_rule(line, &['─', '━', '╌'])
}

/// `1. Yes` is option 1, `Yes` has no number.
fn numbered(label: &str) -> (Option<String>, String) {
    if let Some((number, rest)) = label.split_once(". ")
        && !number.is_empty()
        && number.chars().all(|c| c.is_ascii_digit())
    {
        return (Some(number.to_owned()), rest.trim().to_owned());
    }
    (None, label.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PERMISSION: &str = "\
────────────────────────────────────────
 Bash command
 Search for project skills
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 │ d=$PWD; while :; do
 │ done
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Part of this command (quoted text)
 cannot be checked in advance

 Do you want to proceed?
 ❯ 1. Yes
   2. No

 Esc to cancel · Tab to amend";

    const QUESTION: &str = "\
❯ Use the AskUserQuestion tool to ask
  me which color I prefer.
──────────────────────────────────────
 ☐ Color

Which color do you prefer?

❯ 1. Red
     A bold, energetic color
  2. Green
     A calming, natural color
  3. Blue
     A cool, peaceful color
  4. Type something.
──────────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate ·
Esc to cancel";

    const TRUST: &str = "\
 Claude Code'll be able to read,
 edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel";

    fn labels(prompt: &Prompt) -> Vec<&str> {
        prompt.options.iter().map(|c| c.label.as_str()).collect()
    }

    #[test]
    fn permission_prompts_list_their_command() {
        let prompt = parse(PERMISSION).unwrap();
        assert_eq!(prompt.title.as_deref(), Some("Bash command"));
        assert!(prompt.lines.contains(&"d=$PWD; while :; do".to_owned()));
        assert_eq!(prompt.lines.last().unwrap(), "Do you want to proceed?");
        assert_eq!(labels(&prompt), ["Yes", "No"]);
        assert_eq!(prompt.options[1].keys, ["2"]);
    }

    #[test]
    fn questions_keep_descriptions_and_cross_rules() {
        let prompt = parse(QUESTION).unwrap();
        assert_eq!(prompt.title.as_deref(), Some("Color"));
        assert_eq!(prompt.lines, ["Which color do you prefer?"]);
        assert_eq!(
            labels(&prompt),
            ["Red", "Green", "Blue", "Type something.", "Chat about this"]
        );
        assert_eq!(
            prompt.options[2].description.as_deref(),
            Some("A cool, peaceful color")
        );
        assert_eq!(prompt.options[4].keys, ["5"]);
    }

    #[test]
    fn unnumbered_choices_use_arrows() {
        let prompt = parse(TRUST).unwrap();
        assert_eq!(labels(&prompt), ["No, exit", "Yes, I trust this folder"]);
        assert_eq!(prompt.options[0].keys, ["Enter"]);
        assert_eq!(prompt.options[1].keys, ["Down", "Enter"]);
    }

    #[test]
    fn an_empty_input_box_is_not_a_prompt() {
        assert_eq!(parse("● Done.\n────\n❯\n────\n  ? for shortcuts"), None);
    }
}
