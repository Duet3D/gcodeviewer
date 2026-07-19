// Ultra-fast number parsing optimized for G-code
// This parser is designed to be much faster than Rust's standard parse() method
// by avoiding string allocations and using direct byte manipulation

use crate::gcode_line::Vector3;

#[derive(Debug, Clone, Copy)]
pub struct ParseResult {
    pub value: f64,
    pub consumed_bytes: usize,
}

impl ParseResult {
    pub fn new(value: f64, consumed_bytes: usize) -> Self {
        Self { value, consumed_bytes }
    }
}

/// Ultra-fast floating point number parser optimized for G-code
/// Returns (value, bytes_consumed)
pub fn parse_number_fast(bytes: &[u8], start_idx: usize) -> Option<ParseResult> {
    if start_idx >= bytes.len() {
        return None;
    }
    
    let mut idx = start_idx;
    let len = bytes.len();
    
    // Skip whitespace
    while idx < len && bytes[idx] == b' ' {
        idx += 1;
    }
    
    if idx >= len {
        return None;
    }
    
    let mut negative = false;
    let mut integer_part: u64 = 0;
    let mut decimal_part: u64 = 0;
    let mut decimal_places: u32 = 0;
    let mut has_decimal = false;
    let mut found_digit = false;
    
    // Handle sign
    if bytes[idx] == b'-' {
        negative = true;
        idx += 1;
    } else if bytes[idx] == b'+' {
        idx += 1;
    }
    
    // Parse integer part
    while idx < len {
        let byte = bytes[idx];
        match byte {
            b'0'..=b'9' => {
                found_digit = true;
                let digit = (byte - b'0') as u64;
                
                // Prevent overflow - if we're getting too large, use f64 parsing
                if integer_part > u64::MAX / 10 {
                    return fallback_parse(bytes, start_idx);
                }
                
                integer_part = integer_part * 10 + digit;
                idx += 1;
            }
            b'.' => {
                if has_decimal {
                    break; // Second decimal point, stop parsing
                }
                has_decimal = true;
                idx += 1;
                break;
            }
            _ => break, // Non-digit, non-decimal character
        }
    }
    
    // Parse decimal part if we found a decimal point
    if has_decimal {
        while idx < len && decimal_places < 10 { // Limit precision to prevent overflow
            let byte = bytes[idx];
            match byte {
                b'0'..=b'9' => {
                    found_digit = true;
                    let digit = (byte - b'0') as u64;
                    decimal_part = decimal_part * 10 + digit;
                    decimal_places += 1;
                    idx += 1;
                }
                _ => break, // Non-digit character
            }
        }
        
        // Skip any remaining digits to advance the index properly
        while idx < len && bytes[idx].is_ascii_digit() {
            idx += 1;
        }
    }
    
    if !found_digit {
        return None;
    }
    
    // Convert to float
    let mut result = integer_part as f64;
    
    if has_decimal && decimal_places > 0 {
        let divisor = 10_u64.pow(decimal_places) as f64;
        result += decimal_part as f64 / divisor;
    }
    
    if negative {
        result = -result;
    }
    
    Some(ParseResult::new(result, idx - start_idx))
}

// Fallback parser using standard library (for edge cases)
fn fallback_parse(bytes: &[u8], start_idx: usize) -> Option<ParseResult> {
    let mut end_idx = start_idx;
    
    // Find the end of the number
    while end_idx < bytes.len() {
        match bytes[end_idx] {
            b'0'..=b'9' | b'.' | b'-' | b'+' | b'e' | b'E' => end_idx += 1,
            _ => break,
        }
    }
    
    if end_idx == start_idx {
        return None;
    }
    
    // Convert to string and parse
    if let Ok(s) = std::str::from_utf8(&bytes[start_idx..end_idx]) {
        if let Ok(value) = s.parse::<f64>() {
            return Some(ParseResult::new(value, end_idx - start_idx));
        }
    }
    
    None
}

/// Parse a G-code parameter (letter followed by number)
/// Returns (letter, value, bytes_consumed)
pub fn parse_parameter(bytes: &[u8], start_idx: usize) -> Option<(char, f64, usize)> {
    if start_idx >= bytes.len() {
        return None;
    }
    
    let letter_byte = bytes[start_idx];
    
    // Must start with a letter
    if !letter_byte.is_ascii_alphabetic() {
        return None;
    }
    
    let letter = letter_byte.to_ascii_uppercase() as char;
    
    // Parse the number after the letter
    if let Some(parse_result) = parse_number_fast(bytes, start_idx + 1) {
        Some((letter, parse_result.value, 1 + parse_result.consumed_bytes))
    } else {
        None
    }
}

/// Split a line into tokens starting with letters
pub fn tokenize_gcode_line(line: &str) -> Vec<&str> {
    let bytes = line.as_bytes();
    let mut tokens = Vec::new();
    let mut start = 0;
    
    // Skip leading whitespace
    while start < bytes.len() && bytes[start] == b' ' {
        start += 1;
    }
    
    let mut i = start;
    while i < bytes.len() {
        // If we find a letter, this might be the start of a new token
        if bytes[i].is_ascii_alphabetic() && i > start {
            // Add the previous token
            if start < i {
                tokens.push(&line[start..i]);
            }
            start = i;
        }
        i += 1;
    }
    
    // Add the last token
    if start < bytes.len() {
        tokens.push(&line[start..]);
    }
    
    tokens
}

/// Check if a line is a comment (starts with ; or is empty/whitespace)
pub fn is_comment_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.is_empty() || trimmed.starts_with(';')
}

/// Extract comment text from a comment line
pub fn extract_comment(line: &str) -> &str {
    let trimmed = line.trim();
    if trimmed.starts_with(';') {
        trimmed[1..].trim()
    } else {
        trimmed
    }
}

/// Fast G-code command detection
pub fn detect_gcode_command(line: &str) -> Option<&str> {
    let bytes = line.as_bytes();
    let mut i = 0;
    
    // Skip leading whitespace
    while i < bytes.len() && bytes[i] == b' ' {
        i += 1;
    }
    
    if i >= bytes.len() {
        return None;
    }
    
    // Must start with G, M, or T
    let first_char = bytes[i];
    if first_char != b'G' && first_char != b'g' && 
       first_char != b'M' && first_char != b'm' &&
       first_char != b'T' && first_char != b't' {
        return None;
    }
    
    let start = i;
    i += 1;
    
    // Parse number after the letter
    while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
        i += 1;
    }
    
    if i > start + 1 {
        Some(&line[start..i])
    } else {
        None
    }
}

/// Calculate distance between two 3D points
pub fn distance_3d(p1: &[f64; 3], p2: &[f64; 3]) -> f64 {
    let dx = p1[0] - p2[0];
    let dy = p1[1] - p2[1];
    let dz = p1[2] - p2[2];
    (dx * dx + dy * dy + dz * dz).sqrt()
}

/// Normalize a 3D vector
pub fn normalize_3d(v: &[f64; 3]) -> [f64; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if length > 0.0 {
        [v[0] / length, v[1] / length, v[2] / length]
    } else {
        [0.0, 0.0, 0.0]
    }
}

/// Fast string to uppercase conversion for G-code commands
pub fn to_uppercase_ascii(s: &str) -> String {
    s.chars()
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

/// Skip whitespace characters and return new position
pub fn skip_whitespace(bytes: &[u8], mut pos: usize) -> usize {
    while pos < bytes.len() && (bytes[pos] == b' ' || bytes[pos] == b'\t') {
        pos += 1;
    }
    pos
}

/// Parse number from string (wrapper for compatibility)
pub fn parse_number_from_str(line: &str, start_pos: usize) -> Result<(f64, usize), String> {
    let bytes = line.as_bytes();
    if let Some(result) = parse_number_fast(bytes, start_pos) {
        Ok((result.value, start_pos + result.consumed_bytes))
    } else {
        Err("Failed to parse number".to_string())
    }
}

/// Arc tessellation result containing intermediate points
#[derive(Debug, Clone)]
pub struct ArcResult {
    pub final_position: Vector3,
    pub intermediate_points: Vec<Vector3>,
}

/// Arc plane specification
#[derive(Debug, Clone, Copy)]
pub enum ArcPlane {
    XY,
    XZ, 
    YZ,
}

/// Generate tessellated points for G2/G3 arc moves, equivalent to TypeScript's doArc.
/// Positions are in the Babylon frame (x = G-code X, y = height, z = G-code Y) and must already be
/// fully resolved (workplace offsets applied by the parser). Offsets i/j/k are G-code X/Y/Z center
/// offsets from the start point
pub fn tessellate_arc(
    current_position: Vector3,
    target_position: Vector3,
    i_offset: f64,
    j_offset: f64,
    k_offset: Option<f64>,
    radius: Option<f64>,
    is_clockwise: bool,
    arc_plane: ArcPlane,
    arc_segment_length: f64,
    fix_radius: bool,
) -> Result<ArcResult, String> {

    let current = current_position;
    let target = target_position;

    let k = k_offset.unwrap_or(0.0);

    // Work in G-code axes (x, y, z-up); positions convert back to the Babylon frame on output.
    // G17 (XY) uses I/J, G18 (XZ) uses I/K, G19 (YZ) uses J/K as (axis0, axis1) center offsets
    let (axis0_idx, axis1_idx, axis2_idx, mut i, mut j) = match arc_plane {
        ArcPlane::XY => (0, 1, 2, i_offset, j_offset),
        ArcPlane::XZ => (2, 0, 1, k, i_offset), // axis0 = Z inverted for correct direction per RRF
        ArcPlane::YZ => (1, 2, 0, j_offset, k),
    };

    let current_array = [current.x, current.z, current.y];
    let target_array = [target.x, target.z, target.y];
    
    // Handle radius-based arc specification (R parameter)
    if let Some(r) = radius {
        let delta0 = target_array[axis0_idx] - current_array[axis0_idx];
        let delta1 = target_array[axis1_idx] - current_array[axis1_idx];
        
        let d_squared = delta0 * delta0 + delta1 * delta1;
        if d_squared == 0.0 {
            return Ok(ArcResult {
                final_position: target,
                intermediate_points: vec![],
            });
        }
        
        let mut h_squared = r * r - d_squared / 4.0;
        let mut h_div_d = 0.0;
        
        if h_squared >= 0.0 {
            h_div_d = (h_squared / d_squared).sqrt();
        } else {
            if h_squared < -0.02 * r * r {
                if fix_radius {
                    let min_r = ((delta0 / 2.0).powi(2) + (delta1 / 2.0).powi(2)).sqrt();
                    h_squared = min_r * min_r - d_squared / 4.0;
                    h_div_d = (h_squared / d_squared).sqrt();
                } else {
                    return Err("G2/G3: Radius too small".to_string());
                }
            }
        }
        
        // Determine direction based on RRF logic
        if (is_clockwise && r < 0.0) || (!is_clockwise && r > 0.0) {
            h_div_d = -h_div_d;
        }
        
        i = delta0 / 2.0 + delta1 * h_div_d;
        j = delta1 / 2.0 - delta0 * h_div_d;
    } else {
        // Center point is offset from current position
        if i == 0.0 && j == 0.0 {
            return Ok(ArcResult {
                final_position: target,
                intermediate_points: vec![],
            });
        }
    }
    
    let whole_circle = current_array[axis0_idx] == target_array[axis0_idx] && 
                      current_array[axis1_idx] == target_array[axis1_idx];
    
    let center0 = current_array[axis0_idx] + i;
    let center1 = current_array[axis1_idx] + j;
    
    let arc_radius = (i * i + j * j).sqrt();
    let arc_current_angle = (-j).atan2(-i);
    let final_theta = (target_array[axis1_idx] - center1).atan2(target_array[axis0_idx] - center0);
    
    let total_arc = if whole_circle {
        2.0 * std::f64::consts::PI
    } else {
        let mut arc = if is_clockwise {
            arc_current_angle - final_theta
        } else {
            final_theta - arc_current_angle
        };
        
        if arc < 0.0 {
            arc += 2.0 * std::f64::consts::PI;
        }
        arc
    };
    
    let mut total_segments = (arc_radius * total_arc) / arc_segment_length;
    if total_segments < 1.0 {
        total_segments = 1.0;
    }
    let total_segments = total_segments as usize;
    
    let arc_angle_increment = if is_clockwise {
        -(total_arc / total_segments as f64)
    } else {
        total_arc / total_segments as f64
    };
    
    let axis2_dist = target_array[axis2_idx] - current_array[axis2_idx];
    let axis2_step = axis2_dist / total_segments as f64;
    
    let mut points = Vec::with_capacity(total_segments);
    let mut current_angle = arc_current_angle;
    let mut p2 = current_array[axis2_idx];
    
    // Generate intermediate points
    for _ in 0..(total_segments - 1) {
        current_angle += arc_angle_increment;
        let p0 = center0 + arc_radius * current_angle.cos();
        let p1 = center1 + arc_radius * current_angle.sin();
        p2 += axis2_step;
        
        // Map the in-plane point back to G-code axes, then to the Babylon frame (x, height, G-code Y)
        let world_point = match arc_plane {
            ArcPlane::XY => Vector3 { x: p0, y: p2, z: p1 },
            ArcPlane::XZ => Vector3 { x: p1, y: p0, z: p2 },
            ArcPlane::YZ => Vector3 { x: p2, y: p1, z: p0 },
        };

        points.push(world_point);
    }
    
    // Add final point and save a copy for the result
    let final_pos = target.clone();
    points.push(target);
    
    Ok(ArcResult {
        final_position: final_pos,
        intermediate_points: points,
    })
}

// Performance testing utilities
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_number_fast() {
        let test_cases = vec![
            ("123", Some(123.0)),
            ("123.456", Some(123.456)),
            ("-45.67", Some(-45.67)),
            ("+89.12", Some(89.12)),
            ("  42  ", Some(42.0)),
            ("0.001", Some(0.001)),
            ("1000000", Some(1000000.0)),
            ("invalid", None),
            ("", None),
        ];
        
        for (input, expected) in test_cases {
            let bytes = input.as_bytes();
            let result = parse_number_fast(bytes, 0);
            
            match (result, expected) {
                (Some(ParseResult { value, .. }), Some(expected_val)) => {
                    assert!((value - expected_val).abs() < 1e-10, 
                           "Failed for input '{}': expected {}, got {}", input, expected_val, value);
                }
                (None, None) => {} // Both None, test passed
                _ => panic!("Failed for input '{}': expected {:?}, got {:?}", input, expected, result),
            }
        }
    }
    
    #[test]
    fn test_parse_parameter() {
        let test_cases = vec![
            ("X123.45", Some(('X', 123.45, 7))),
            ("Y-67.89", Some(('Y', -67.89, 7))),
            ("Z0.1", Some(('Z', 0.1, 4))),
            ("F1500", Some(('F', 1500.0, 5))),
            ("E0.05", Some(('E', 0.05, 5))),
            ("123", None), // No letter
            ("", None),
        ];
        
        for (input, expected) in test_cases {
            let bytes = input.as_bytes();
            let result = parse_parameter(bytes, 0);
            
            match (result, expected) {
                (Some((letter, value, consumed)), Some((exp_letter, exp_value, exp_consumed))) => {
                    assert_eq!(letter, exp_letter);
                    assert!((value - exp_value).abs() < 1e-10);
                    assert_eq!(consumed, exp_consumed);
                }
                (None, None) => {} // Both None, test passed
                _ => panic!("Failed for input '{}': expected {:?}, got {:?}", input, expected, result),
            }
        }
    }
    
    #[test]
    fn test_is_comment_line() {
        assert!(is_comment_line("; This is a comment"));
        assert!(is_comment_line("  ; Another comment  "));
        assert!(is_comment_line(""));
        assert!(is_comment_line("   "));
        assert!(!is_comment_line("G0 X10"));
        assert!(!is_comment_line("M104 S200"));
    }
    
    #[test]
    fn test_detect_gcode_command() {
        assert_eq!(detect_gcode_command("G0 X10 Y20"), Some("G0"));
        assert_eq!(detect_gcode_command("  G1  X5"), Some("G1"));
        assert_eq!(detect_gcode_command("M104 S200"), Some("M104"));
        assert_eq!(detect_gcode_command("T1"), Some("T1"));
        assert_eq!(detect_gcode_command("; comment"), None);
        assert_eq!(detect_gcode_command(""), None);
    }
}