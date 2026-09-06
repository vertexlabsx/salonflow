pub fn normalize_phone_india(value: &str) -> String {
    let digits: String = value.chars().filter(|c| c.is_ascii_digit()).collect();
    let digits = digits.trim_start_matches('0');
    if digits.len() == 10 {
        format!("91{digits}")
    } else {
        digits.to_string()
    }
}