use crate::gcode_line::{GCodeLine, ArcMove, Vector3};
use crate::processor_properties::ProcessorProperties;
use crate::utils::{parse_number_fast, skip_whitespace};

/// Parse G2 (clockwise arc) and G3 (counter-clockwise arc) commands
/// Format: G2/G3 Xnnn Ynnn Znnn Innn Jnnn Knnn Ennn Fnnn
/// I, J, K are the arc center offsets from start position
/// R can be used instead of I,J for radius (not implemented yet)
pub fn parse_arc_move(
    properties: &mut ProcessorProperties,
    line: &str,
    is_clockwise: bool,
    file_position: u32,
    line_number: u32,
) -> Result<GCodeLine, String> {
    
    // current_position is in Babylon frame: x = G-code X, y = height (G-code Z), z = G-code Y.
    // The parameter cases below apply the same Y<->Z swap as the G0/G1 parser
    let mut x = properties.current_position.x;
    let mut y = properties.current_position.y;
    let mut z = properties.current_position.z;
    let mut e = properties.current_e;
    let mut feed_rate = properties.current_feed_rate;
    let unit = properties.units_multiplier();

    // Arc center offsets in G-code axes: i = X offset, j = Y offset, k = Z offset
    let mut i: f64 = 0.0;
    let mut j: f64 = 0.0;
    let mut k: f64 = 0.0;
    let mut radius: Option<f64> = None;
    
    let line_bytes = line.as_bytes();
    let mut pos = 0;
    
    // Skip G2/G3 command
    while pos < line_bytes.len() && line_bytes[pos] != b' ' && line_bytes[pos] != b'\t' {
        pos += 1;
    }
    
    while pos < line_bytes.len() {
        pos = skip_whitespace(line_bytes, pos);
        
        if pos >= line_bytes.len() {
            break;
        }
        
        let param_char = line_bytes[pos] as char;
        pos += 1;
        
        match param_char {
            'X' | 'x' => {
                let parse_result = parse_number_fast(&line_bytes, pos).ok_or("Failed to parse number")?;
                let value = parse_result.value * unit;
                let new_pos = pos + parse_result.consumed_bytes;
                x = if properties.absolute_positioning { value + properties.current_workplace().x } else { properties.current_position.x + value };
                pos = new_pos;
            }
            'Y' | 'y' => {
                let parse_result = parse_number_fast(&line_bytes, pos).ok_or("Failed to parse number")?;
                let value = parse_result.value * unit;
                let new_pos = pos + parse_result.consumed_bytes;
                z = if properties.absolute_positioning { value + properties.current_workplace().y } else { properties.current_position.z + value };
                pos = new_pos;
            }
            'Z' | 'z' => {
                let parse_result = parse_number_fast(&line_bytes, pos).ok_or("Failed to parse number")?;
                let value = parse_result.value * unit;
                let new_pos = pos + parse_result.consumed_bytes;
                y = if properties.absolute_positioning { value + properties.current_workplace().z } else { properties.current_position.y + value };
                pos = new_pos;
            }
            'I' | 'i' => {
                let parse_result = parse_number_fast(&line_bytes, pos).ok_or("Failed to parse number")?;
                i = parse_result.value * unit;
                pos += parse_result.consumed_bytes;
            }
            'J' | 'j' => {
                let parse_result = parse_number_fast(&line_bytes, pos).ok_or("Failed to parse number")?;
                j = parse_result.value * unit;
                pos += parse_result.consumed_bytes;
            }
            'K' | 'k' => {
                let parse_result = parse_number_fast(&line_bytes, pos).ok_or("Failed to parse number")?;
                k = parse_result.value * unit;
                pos += parse_result.consumed_bytes;
            }
            'R' | 'r' => {
                let parse_result = parse_number_fast(&line_bytes, pos).ok_or("Failed to parse number")?;
                radius = Some(parse_result.value * unit);
                pos += parse_result.consumed_bytes;
            }
            'E' | 'e' => {
                let parse_result = parse_number_fast(&line_bytes, pos).ok_or("Failed to parse number")?;
                let value = parse_result.value;
                let new_pos = pos + parse_result.consumed_bytes;
                e = if properties.absolute_extrusion { value } else { properties.current_e + value };
                pos = new_pos;
            }
            'F' | 'f' => {
                let parse_result = parse_number_fast(&line_bytes, pos).ok_or("Failed to parse number")?;
                feed_rate = parse_result.value * unit;
                pos += parse_result.consumed_bytes;
            }
            ';' => break, // Comment start, ignore rest
            _ => {
                // Skip unknown parameters
                while pos < line_bytes.len() && !line_bytes[pos].is_ascii_whitespace() {
                    pos += 1;
                }
            }
        }
    }
    
    // Arc center in the same Babylon frame as the positions: I is a G-code X offset, J a G-code Y
    // offset (Babylon z), K a G-code Z offset (Babylon y)
    let center = Vector3 {
        x: properties.current_position.x + i,
        y: properties.current_position.y + k,
        z: properties.current_position.z + j,
    };

    let start_pos = properties.current_position.clone();
    let end_pos = Vector3 { x, y, z };

    // Determine if extruding
    let extruding = if properties.absolute_extrusion {
        e > properties.current_e + 0.0001
    } else {
        e > 0.0001
    };

    // Update statistics before current_e is overwritten
    if extruding {
        properties.total_extrusion += if properties.absolute_extrusion {
            e - properties.current_e
        } else {
            e
        };
        properties.total_rendered_segments += 1;
    }

    // Update processor state
    properties.current_position = end_pos.clone();
    properties.current_e = e;
    properties.set_feed_rate(feed_rate);
    if extruding {
        properties.record_extrusion_feed_rate(feed_rate);
    }

    // Track height bounds (Babylon y is the height axis)
    properties.update_height(y);

    let arc_move = ArcMove {
        file_position,
        line_number,
        original_line: line.to_string(),
        tool: properties.current_tool.tool_number,
        start: start_pos,
        end: end_pos,
        center,
        radius,
        clockwise: is_clockwise,
        extruding,
        color: properties.current_tool.color.clone(),
        feed_rate,
        segments: vec![], // Will be populated during rendering if needed
    };
    
    Ok(GCodeLine::Arc(arc_move))
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_g2_arc() {
        let mut props = ProcessorProperties::new();
        // Babylon frame: x = G-code X, y = height (G-code Z), z = G-code Y
        props.current_position = Vector3 { x: 10.0, y: 0.3, z: 10.0 };
        props.current_e = 0.0;

        let result = parse_arc_move(&mut props, "G2 X20 Y20 I5 J5 E0.1 F1500", true, 100, 1);
        assert!(result.is_ok());

        if let Ok(GCodeLine::Arc(arc)) = result {
            assert_eq!(arc.start.x, 10.0);
            assert_eq!(arc.start.z, 10.0);
            assert_eq!(arc.end.x, 20.0);
            assert_eq!(arc.end.z, 20.0); // G-code Y lands in the Babylon z slot
            assert_eq!(arc.end.y, 0.3); // height unchanged
            assert_eq!(arc.center.x, 15.0); // 10 + I5
            assert_eq!(arc.center.z, 15.0); // 10 + J5
            assert!(arc.clockwise);
            assert!(arc.extruding);
            assert_eq!(arc.feed_rate, 1500.0);
        } else {
            panic!("Expected Arc move");
        }
    }

    #[test]
    fn test_parse_g3_arc() {
        let mut props = ProcessorProperties::new();
        props.current_position = Vector3 { x: 0.0, y: 0.5, z: 0.0 };

        let result = parse_arc_move(&mut props, "G3 X10 Y0 I5 J0", false, 200, 2);
        assert!(result.is_ok());

        if let Ok(GCodeLine::Arc(arc)) = result {
            assert!(!arc.clockwise);
            assert!(!arc.extruding); // No E parameter
            assert_eq!(arc.center.x, 5.0);
            assert_eq!(arc.center.z, 0.0);
        } else {
            panic!("Expected Arc move");
        }
    }
}