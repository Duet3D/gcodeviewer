use crate::gcode_line::{GCodeLine, CommandData};
use crate::processor_properties::{ProcessorProperties, Units};

/// Parse G20 (Inches Units) command
/// G20: Set units to inches
pub fn parse_g20_inches(
    properties: &mut ProcessorProperties,
    line: &str,
    file_position: u32,
    line_number: u32,
) -> Result<GCodeLine, String> {
    
    // Set units to inches
    properties.units = Units::Inches;
    
    // Create command data
    let cmd_data = CommandData::new(file_position, line_number, line.to_string(), "G20".to_string());
    Ok(GCodeLine::Command(cmd_data))
}

/// Parse G21 (Millimeters Units) command
/// G21: Set units to millimeters  
pub fn parse_g21_millimeters(
    properties: &mut ProcessorProperties,
    line: &str,
    file_position: u32,
    line_number: u32,
) -> Result<GCodeLine, String> {
    
    // Set units to millimeters
    properties.units = Units::Millimeters;
    
    // Create command data
    let cmd_data = CommandData::new(file_position, line_number, line.to_string(), "G21".to_string());
    Ok(GCodeLine::Command(cmd_data))
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_g20_inches() {
        let mut props = ProcessorProperties::new();
        // Default should be millimeters
        assert!(matches!(props.units, Units::Millimeters));
        
        let result = parse_g20_inches(&mut props, "G20", 100, 1);
        assert!(result.is_ok());
        assert!(matches!(props.units, Units::Inches));
    }
    
    #[test]
    fn test_parse_g21_millimeters() {
        let mut props = ProcessorProperties::new();
        props.units = Units::Inches; // Start with inches
        
        let result = parse_g21_millimeters(&mut props, "G21", 200, 2);
        assert!(result.is_ok());
        assert!(matches!(props.units, Units::Millimeters));
    }
    
    #[test]
    fn test_units_multiplier() {
        let mut props = ProcessorProperties::new();
        
        // Test millimeters
        props.units = Units::Millimeters;
        assert_eq!(props.units_multiplier(), 1.0);
        
        // Test inches  
        props.units = Units::Inches;
        assert_eq!(props.units_multiplier(), 25.4);
    }
}