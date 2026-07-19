use crate::gcode_line::{GCodeLine, GCodeLineBase};
use crate::processor_properties::ProcessorProperties;
use crate::GCodeCommands::ProcessLine::process_line;
use crate::slicers::detect_slicer;
use crate::{PositionData, ProgressCallback};
use std::collections::HashMap;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

// Console logging for WASM
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

// wasm-bindgen imports panic when called on native targets, which breaks `cargo test`
#[cfg(target_arch = "wasm32")]
macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[cfg(not(target_arch = "wasm32"))]
macro_rules! console_log {
    ($($t:tt)*) => (println!($($t)*))
}

/// High-performance file processor optimized for WASM
pub struct FileProcessor {
    properties: ProcessorProperties,
}

impl FileProcessor {
    pub fn new() -> Self {
        Self {
            properties: ProcessorProperties::new(),
        }
    }
    
    /// Process G-code file content.
    /// Returns (gcode_lines, position_tracker, render_segments): the tracker maps line file
    /// positions to their end state for animation, render_segments lists every renderable segment
    /// (arcs contribute one entry per tessellated piece) in file order for buffer generation
    pub fn process_file_content(
        &mut self,
        file_content: &str,
        progress_callback: Option<ProgressCallback>,
    ) -> Result<(Vec<GCodeLine>, HashMap<u32, PositionData>, Vec<PositionData>), String> {

        // Reset processor state for new file
        self.properties.reset();

        // Detect slicer type and initialize colors
        let slicer = detect_slicer(file_content);
        self.properties.slicer_name = slicer.get_name().to_string();

        // Initialize default feature color from slicer
        self.properties.current_feature_color = slicer.get_feature_color(&crate::slicers::slicer_base::FeatureType::Perimeter);

        // Estimate processing parameters
        let file_length = file_content.len();
        let estimated_lines = file_length / 40; // Average ~40 chars per line
        let chunk_size = 10000.min(estimated_lines / 10).max(1); // Process in chunks; 0 would panic in the modulo below

        console_log!("Processing {} bytes, estimated {} lines in chunks of {}",
                    file_length, estimated_lines, chunk_size);

        // Pre-allocate result vectors with estimated capacity
        let mut gcode_lines = Vec::with_capacity(estimated_lines + estimated_lines / 5); // +20% buffer
        let mut position_tracker = HashMap::with_capacity(estimated_lines * 7 / 10); // ~70% moves
        let mut render_segments: Vec<PositionData> = Vec::with_capacity(estimated_lines * 7 / 10);

        // Stream through file line by line for optimal memory usage
        let mut file_position = 0u32;
        let mut line_number = 1u32;
        let mut lines_processed = 0usize;
        let mut last_progress_report = 0f64;

        // split('\n') keeps a trailing '\r' in each line, so line.len() + 1 stays a correct byte
        // count on CRLF files - .lines() strips the '\r' and would drift one byte per line
        let mut line_iter = file_content.split('\n').peekable();
        while let Some(line) = line_iter.next() {
            if line_iter.peek().is_none() && line.is_empty() {
                break; // trailing newline produces one empty final piece, not a real line
            }
            // Update position tracking
            self.properties.file_position = file_position;
            self.properties.line_number = line_number;

            // Process slicer comments for feature detection (before G-code processing).
            // OrcaSlicer/BambuStudio use "; FEATURE:" instead of ";TYPE:"
            let trimmed = line.trim();
            if trimmed.starts_with(";TYPE:") || trimmed.starts_with("; FEATURE:") || trimmed.starts_with(";FEATURE:") {
                self.process_feature_comment(&slicer, trimmed);
            }

            match process_line(&mut self.properties, line, file_position, line_number) {
                Ok(gcode_line) => {
                    // Store position data for both extruding and travel moves
                    if let Some(move_data) = gcode_line.as_move() {
                        if move_data.end.x.is_finite() &&
                           move_data.end.y.is_finite() && move_data.end.z.is_finite() &&
                           move_data.start.x.is_finite() && move_data.start.y.is_finite() && move_data.start.z.is_finite() {

                            let pos_data = PositionData::new_with_color(
                                move_data.start.x, move_data.start.y, move_data.start.z,
                                move_data.end.x, move_data.end.y, move_data.end.z,
                                move_data.feed_rate,
                                move_data.extruding,
                                move_data.layer_height,
                                move_data.is_perimeter,
                                move_data.color.clone(),
                                line_number,
                                file_position,
                                (file_position + line.len() as u32),
                                move_data.tool as u32,
                                move_data.is_support,
                            );

                            render_segments.push(pos_data.clone());
                            position_tracker.insert(file_position, pos_data);
                        }
                    } else if let Some(arc) = gcode_line.as_arc() {
                        // Tessellate arcs into line segments for rendering when extruding
                        if arc.extruding {
                            // Center offsets back in G-code axes: Babylon y is the G-code Z axis
                            let i_off = arc.center.x - arc.start.x;
                            let j_off = arc.center.z - arc.start.z;
                            let k_off = arc.center.y - arc.start.y;

                            let fix_radius = self.properties.fix_radius;

                            // Arc segment length similar to TS (0.5mm)
                            let arc_seg_len = 0.5f64;

                            // Map processor_properties::ArcPlane -> utils::ArcPlane
                            let utils_plane = match self.properties.arc_plane.clone() {
                                crate::processor_properties::ArcPlane::XY => crate::utils::ArcPlane::XY,
                                crate::processor_properties::ArcPlane::XZ => crate::utils::ArcPlane::XZ,
                                crate::processor_properties::ArcPlane::YZ => crate::utils::ArcPlane::YZ,
                            };

                            if let Ok(arc_result) = crate::utils::tessellate_arc(
                                arc.start.clone(),
                                arc.end.clone(),
                                i_off,
                                j_off,
                                Some(k_off),
                                arc.radius,
                                arc.clockwise,
                                utils_plane,
                                arc_seg_len,
                                fix_radius,
                            ) {
                                // Segments only feed the render buffers; the tracker gets a single
                                // entry for the whole arc so its keys stay real byte offsets
                                let mut seg_start = arc.start.clone();
                                for p in arc_result.intermediate_points {
                                    let pd = PositionData::new_with_color(
                                        seg_start.x, seg_start.y, seg_start.z,
                                        p.x, p.y, p.z,
                                        arc.feed_rate,
                                        true,
                                        0.2,
                                        self.properties.current_is_perimeter,
                                        self.properties.current_feature_color.clone(),
                                        line_number,
                                        file_position,
                                        (file_position + line.len() as u32),
                                        self.properties.current_tool.tool_number as u32,
                                        self.properties.current_is_support,
                                    );
                                    seg_start = p.clone();
                                    render_segments.push(pd);
                                }
                            }

                            let arc_end = PositionData::new_with_color(
                                arc.start.x, arc.start.y, arc.start.z,
                                arc.end.x, arc.end.y, arc.end.z,
                                arc.feed_rate,
                                true,
                                0.2,
                                self.properties.current_is_perimeter,
                                self.properties.current_feature_color.clone(),
                                line_number,
                                file_position,
                                (file_position + line.len() as u32),
                                self.properties.current_tool.tool_number as u32,
                                self.properties.current_is_support,
                            );
                            position_tracker.insert(file_position, arc_end);
                        }
                    }

                    gcode_lines.push(gcode_line);
                }
                Err(error) => {
                    console_log!("Warning: Failed to parse line {}: {} ({})", line_number, error, line);
                    // Create a comment for unparseable lines
                    gcode_lines.push(GCodeLine::new_comment(file_position, line_number, line.to_string()));
                }
            }

            // Update position for next line (account for stripped newline)
            file_position += line.len() as u32 + 1;
            line_number += 1;
            lines_processed += 1;

            // Report progress every chunk or 2%
            if lines_processed % chunk_size == 0 || lines_processed % (estimated_lines / 50).max(1000) == 0 {
                let progress = lines_processed as f64 / estimated_lines as f64;

                // Only report if progress changed significantly (reduces callback overhead)
                if progress - last_progress_report >= 0.02 {
                    if let Some(ref callback) = progress_callback {
                        callback.call(progress.min(1.0), "Processing G-code");
                    }
                    last_progress_report = progress;
                }
            }
        }

        // Final progress report
        if let Some(ref callback) = progress_callback {
            callback.call(1.0, "Processing complete");
        }

        // Update final statistics
        self.properties.line_count = line_number - 1;

        console_log!("Processing complete: {} lines, {} moves, {} render segments",
                    gcode_lines.len(),
                    position_tracker.len(),
                    render_segments.len());

        Ok((gcode_lines, position_tracker, render_segments))
    }
    
    /// Get processing statistics
    pub fn get_statistics(&self) -> ProcessorStatistics {
        ProcessorStatistics {
            line_count: self.properties.line_count,
            max_height: self.properties.max_height,
            min_height: self.properties.min_height,
            max_feed_rate: self.properties.max_feed_rate,
            min_feed_rate: self.properties.min_feed_rate,
            total_segments: self.properties.total_rendered_segments,
            slicer_name: self.properties.slicer_name.clone(),
            first_gcode_byte: self.properties.first_gcode_byte,
            last_gcode_byte: self.properties.last_gcode_byte,
        }
    }
    
    /// Validate file content before processing
    pub fn validate_file_content(file_content: &str) -> Result<(), String> {
        if file_content.is_empty() {
            return Err("File is empty".to_string());
        }
        
        if file_content.len() > 500_000_000 { // 500MB limit
            return Err("File too large (>500MB)".to_string());
        }
        
        // Check if it looks like G-code
        let lines: Vec<&str> = file_content.lines().take(100).collect();
        let mut gcode_lines = 0;
        let mut comment_lines = 0;
        
        for line in &lines {
            let trimmed = line.trim();
            let bytes = trimmed.as_bytes();
            if trimmed.starts_with(';') || trimmed.is_empty() {
                comment_lines += 1;
            } else if bytes.len() >= 2 && (bytes[0] == b'G' || bytes[0] == b'M' || bytes[0] == b'T') && bytes[1].is_ascii_digit() {
                // Require a digit after the letter so plain English text ("This...") does not count
                gcode_lines += 1;
            }
        }
        
        if gcode_lines == 0 && comment_lines < lines.len() / 2 {
            return Err("File does not appear to contain valid G-code".to_string());
        }
        
        Ok(())
    }
    
    /// Process slicer feature comments to update coloring state
    fn process_feature_comment(&mut self, slicer: &Box<dyn crate::slicers::slicer_base::SlicerBase>, line: &str) {
        if let Some(feature) = slicer.parse_feature_from_comment(line) {
            // Update current feature color based on detected feature
            self.properties.current_feature_color = slicer.get_feature_color(&feature);
            self.properties.current_is_perimeter = slicer.is_perimeter_comment(line);
            self.properties.current_is_support = slicer.is_support_comment(line);
        }
    }
}

/// Processing statistics
#[derive(Debug, Clone)]
pub struct ProcessorStatistics {
    pub line_count: u32,
    pub max_height: f64,
    pub min_height: f64,
    pub max_feed_rate: f64,
    pub min_feed_rate: f64,
    pub total_segments: u32,
    pub slicer_name: String,
    pub first_gcode_byte: u32,
    pub last_gcode_byte: u32,
}


impl Default for FileProcessor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_validate_file_content() {
        // Valid G-code
        let valid_gcode = "; Test G-code\nG28 ; Home\nG0 X10 Y20\nG1 X15 Y25 E0.1\nM104 S200";
        assert!(FileProcessor::validate_file_content(valid_gcode).is_ok());
        
        // Empty file
        assert!(FileProcessor::validate_file_content("").is_err());
        
        // Not G-code
        let not_gcode = "This is just text\nwith some lines\nbut no G-code commands";
        assert!(FileProcessor::validate_file_content(not_gcode).is_err());
    }
    
    #[test]
    fn test_process_simple_file() {
        let mut processor = FileProcessor::new();
        
        let simple_gcode = concat!(
            "; Test file\n",
            "G28 ; Home all axes\n", 
            "G0 X10 Y20 Z5\n",
            "G1 X15 Y25 E0.1 F1500\n",
            "M104 S200\n"
        );
        
        let result = processor.process_file_content(simple_gcode, None);
        assert!(result.is_ok());
        
        let (gcode_lines, position_tracker, render_segments) = result.unwrap();
        assert!(gcode_lines.len() >= 4); // At least the lines we specified
        assert!(!position_tracker.is_empty()); // Should have at least one extruding move
        assert!(!render_segments.is_empty());
    }
}
