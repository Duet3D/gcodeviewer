use crate::gcode_line::{GCodeLine, CommandData};
use crate::processor_properties::ProcessorProperties;

/// Parse G10. Bare G10 is firmware retraction; with parameters (P/L/R/S/X/Y/Z) it sets tool or
/// workplace offsets and standby temperatures - untracked state, but not a retract
pub fn parse_g10_retract(
    properties: &mut ProcessorProperties,
    line: &str,
    file_position: u32,
    line_number: u32,
) -> Result<GCodeLine, String> {

    let rest = line.trim()[3..].trim();
    if rest.is_empty() || rest.starts_with(';') {
        properties.firmware_retraction = true;
    } else {
        apply_workplace_offsets(properties, rest);
    }

    // Create command data
    let cmd_data = CommandData::new(file_position, line_number, line.to_string(), "G10".to_string());
    Ok(GCodeLine::Command(cmd_data))
}

/// G10 L2 sets a workplace origin to the given machine coordinates, G10 L20 sets it so that the
/// current position reads as the given values. Axes the command leaves out keep their offset
fn apply_workplace_offsets(properties: &mut ProcessorProperties, rest: &str) {
    let mut mode = 0i32;
    let mut workplace = -1i32;
    let mut x: Option<f64> = None;
    let mut y: Option<f64> = None;
    let mut z: Option<f64> = None;
    let unit = properties.units_multiplier();

    for token in rest.split_whitespace() {
        let mut chars = token.chars();
        let key = match chars.next() {
            Some(c) => c.to_ascii_uppercase(),
            None => continue,
        };
        let value: f64 = match chars.as_str().parse() {
            Ok(v) => v,
            Err(_) => continue,
        };
        match key {
            'L' => mode = value as i32,
            'P' => workplace = value as i32,
            'X' => x = Some(value * unit),
            'Y' => y = Some(value * unit),
            'Z' => z = Some(value * unit),
            _ => {}
        }
    }

    if mode != 2 && mode != 20 {
        return;
    }

    // P is 1-based (P1 = G54); P0 and a missing P both mean the active workplace
    let index = if workplace > 0 {
        (workplace - 1) as usize
    } else {
        properties.current_workplace_idx as usize
    };
    if index >= properties.workplace_offsets.len() {
        return;
    }

    // current_position is already in machine coordinates and stored Babylon-style, so G-code Y
    // lives in z and G-code Z in y
    let position = properties.current_position.clone();
    let offset = &mut properties.workplace_offsets[index].offset;
    if let Some(value) = x {
        offset.x = if mode == 2 { value } else { position.x - value };
    }
    if let Some(value) = y {
        offset.y = if mode == 2 { value } else { position.z - value };
    }
    if let Some(value) = z {
        offset.z = if mode == 2 { value } else { position.y - value };
    }
}

/// Parse G11 (Firmware Unretraction) command
/// G11: Disable firmware retraction (unretract filament)
pub fn parse_g11_unretract(
    properties: &mut ProcessorProperties,
    line: &str,
    file_position: u32,
    line_number: u32,
) -> Result<GCodeLine, String> {
    
    // Disable firmware retraction
    properties.firmware_retraction = false;
    
    // Create command data
    let cmd_data = CommandData::new(file_position, line_number, line.to_string(), "G11".to_string());
    Ok(GCodeLine::Command(cmd_data))
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_g10_retract() {
        let mut props = ProcessorProperties::new();
        props.firmware_retraction = false; // Start disabled
        
        let result = parse_g10_retract(&mut props, "G10", 100, 1);
        assert!(result.is_ok());
        assert!(props.firmware_retraction); // Should now be enabled
        
        if let Ok(GCodeLine::Command(cmd)) = result {
            assert_eq!(cmd.command_type, "G10");
        }
    }
    
    #[test]
    fn test_g10_l2_sets_workplace_origin() {
        let mut props = ProcessorProperties::new();

        let result = parse_g10_retract(&mut props, "G10 L2 P2 X10 Y20 Z5", 100, 1);
        assert!(result.is_ok());
        assert!(!props.firmware_retraction);
        assert_eq!(props.workplace_offsets[1].offset.x, 10.0);
        assert_eq!(props.workplace_offsets[1].offset.y, 20.0);
        assert_eq!(props.workplace_offsets[1].offset.z, 5.0);
        // Axes left out keep their offset, and the other workplaces are untouched
        assert_eq!(props.workplace_offsets[0].offset.x, 0.0);
    }

    #[test]
    fn test_g10_l20_offsets_from_current_position() {
        let mut props = ProcessorProperties::new();
        // Babylon-style storage: G-code Y is z, G-code Z is y
        props.current_position.x = 50.0;
        props.current_position.z = 60.0;
        props.current_position.y = 7.0;

        let result = parse_g10_retract(&mut props, "G10 L20 P1 X0 Y0", 100, 1);
        assert!(result.is_ok());
        assert_eq!(props.workplace_offsets[0].offset.x, 50.0);
        assert_eq!(props.workplace_offsets[0].offset.y, 60.0);
        // Z was not given, so it keeps its previous offset
        assert_eq!(props.workplace_offsets[0].offset.z, 0.0);
    }

    #[test]
    fn test_g10_without_l_leaves_offsets_alone() {
        let mut props = ProcessorProperties::new();

        // Tool offset / standby temperature form - must not touch workplace offsets or retraction
        let result = parse_g10_retract(&mut props, "G10 P1 X5 Y5 S200", 100, 1);
        assert!(result.is_ok());
        assert!(!props.firmware_retraction);
        assert_eq!(props.workplace_offsets[0].offset.x, 0.0);
    }

    #[test]
    fn test_parse_g11_unretract() {
        let mut props = ProcessorProperties::new();
        props.firmware_retraction = true; // Start enabled
        
        let result = parse_g11_unretract(&mut props, "G11", 200, 2);
        assert!(result.is_ok());
        assert!(!props.firmware_retraction); // Should now be disabled
        
        if let Ok(GCodeLine::Command(cmd)) = result {
            assert_eq!(cmd.command_type, "G11");
        }
    }
}