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
    }

    // Create command data
    let cmd_data = CommandData::new(file_position, line_number, line.to_string(), "G10".to_string());
    Ok(GCodeLine::Command(cmd_data))
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