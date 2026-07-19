use crate::gcode_line::{GCodeLine, CommandData};
use crate::processor_properties::ProcessorProperties;
use crate::utils::parse_parameter;

/// Parse G90 (Absolute Positioning) command
/// G90: All coordinates are absolute
pub fn parse_g90_absolute(
    properties: &mut ProcessorProperties,
    line: &str,
    file_position: u32,
    line_number: u32,
) -> Result<GCodeLine, String> {
    
    // Set absolute positioning mode
    properties.absolute_positioning = true;
    
    // Create command data
    let cmd_data = CommandData::new(file_position, line_number, line.to_string(), "G90".to_string());
    Ok(GCodeLine::Command(cmd_data))
}

/// Parse G91 (Relative Positioning) command  
/// G91: All coordinates are relative to current position
pub fn parse_g91_relative(
    properties: &mut ProcessorProperties,
    line: &str,
    file_position: u32,
    line_number: u32,
) -> Result<GCodeLine, String> {
    
    // Set relative positioning mode
    properties.absolute_positioning = false;
    
    // Create command data
    let cmd_data = CommandData::new(file_position, line_number, line.to_string(), "G91".to_string());
    Ok(GCodeLine::Command(cmd_data))
}

/// Parse G92 (Set Position). Redefines the current logical position; only X/Y/Z matter for
/// rendering, E resets are ignored because extrusion detection works per line
pub fn parse_g92_set_position(
    properties: &mut ProcessorProperties,
    line: &str,
    file_position: u32,
    line_number: u32,
) -> Result<GCodeLine, String> {

    let unit = properties.units_multiplier();
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if let Some((letter, value, consumed)) = parse_parameter(bytes, i) {
            i += consumed;
            match letter {
                // Same G-code Z-up to Babylon Y-up swap as the move parsers
                'X' => properties.current_position.x = value * unit + properties.current_workplace().x,
                'Y' => properties.current_position.z = value * unit + properties.current_workplace().y,
                'Z' => properties.current_position.y = value * unit + properties.current_workplace().z,
                _ => {}
            }
        } else {
            i += 1;
        }
    }

    let cmd_data = CommandData::new(file_position, line_number, line.to_string(), "G92".to_string());
    Ok(GCodeLine::Command(cmd_data))
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_g90_absolute() {
        let mut props = ProcessorProperties::new();
        props.absolute_positioning = false; // Start in relative mode
        
        let result = parse_g90_absolute(&mut props, "G90", 100, 1);
        assert!(result.is_ok());
        assert!(props.absolute_positioning); // Should now be absolute
    }
    
    #[test]
    fn test_parse_g91_relative() {
        let mut props = ProcessorProperties::new();
        props.absolute_positioning = true; // Start in absolute mode
        
        let result = parse_g91_relative(&mut props, "G91", 200, 2);
        assert!(result.is_ok());
        assert!(!props.absolute_positioning); // Should now be relative
    }
}