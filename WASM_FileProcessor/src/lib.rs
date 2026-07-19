use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::gcode_line::Color4;

// Import our modules
mod gcode_line;
mod processor_properties;
mod processor;
mod GCodeCommands;
mod slicers;
mod utils;

#[cfg(test)]
mod tests;

// Re-export key types
pub use gcode_line::*;
pub use processor_properties::*;
pub use processor::*;

// Set up panic hook and allocator for WASM
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
    web_sys::console::log_1(&"G-code WASM processor initialized".into());
}

// JavaScript-friendly progress callback
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
    
    // Progress callback function type
    #[wasm_bindgen]
    pub type ProgressCallback;
    
    #[wasm_bindgen(method, js_name = call)]
    pub fn call(this: &ProgressCallback, progress: f64, label: &str);
}

// Macro for easier console logging
macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

// Main processing result structure
#[wasm_bindgen]
#[derive(Clone, Serialize, Deserialize)]
pub struct ProcessingResult {
    success: bool,
    error_message: String,
    line_count: usize,
    move_count: usize,
    processing_time_ms: f64,
}

#[wasm_bindgen]
impl ProcessingResult {
    #[wasm_bindgen(getter)]
    pub fn success(&self) -> bool {
        self.success
    }
    
    #[wasm_bindgen(getter)]
    pub fn error_message(&self) -> String {
        self.error_message.clone()
    }
    
    #[wasm_bindgen]
    pub fn has_error(&self) -> bool {
        !self.error_message.is_empty()
    }
    
    #[wasm_bindgen(constructor)]
    pub fn new(success: bool, error_message: String, line_count: usize, move_count: usize, processing_time_ms: f64) -> ProcessingResult {
        ProcessingResult {
            success,
            error_message,
            line_count,
            move_count,
            processing_time_ms,
        }
    }
    
    #[wasm_bindgen(getter)]
    pub fn line_count(&self) -> usize {
        self.line_count
    }
    
    #[wasm_bindgen(getter)]
    pub fn move_count(&self) -> usize {
        self.move_count
    }
    
    #[wasm_bindgen(getter)]
    pub fn processing_time_ms(&self) -> f64 {
        self.processing_time_ms
    }
}

// Render buffer data for fast mesh generation
#[wasm_bindgen]
pub struct RenderBuffers {
    matrix_data: Vec<f32>,
    color_data: Vec<f32>, 
    pick_data: Vec<f32>,
    file_position_data: Vec<f32>,
    file_end_position_data: Vec<f32>,
    tool_data: Vec<f32>,
    feed_rate_data: Vec<f32>,
    is_perimeter_data: Vec<f32>,
    segment_count: u32,
}

// Buffers are moved out (std::mem::take) rather than cloned: each take_* call transfers the Vec
// across the wasm boundary exactly once and leaves an empty Vec behind, halving peak memory for
// large files. Callers read each buffer once and then free() the object
#[wasm_bindgen]
impl RenderBuffers {
    #[wasm_bindgen(getter)]
    pub fn segment_count(&self) -> u32 {
        self.segment_count
    }

    pub fn take_matrix_data(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.matrix_data)
    }

    pub fn take_color_data(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.color_data)
    }

    pub fn take_pick_data(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.pick_data)
    }

    pub fn take_file_position_data(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.file_position_data)
    }

    pub fn take_file_end_position_data(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.file_end_position_data)
    }

    pub fn take_tool_data(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.tool_data)
    }

    pub fn take_feed_rate_data(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.feed_rate_data)
    }

    pub fn take_is_perimeter_data(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.is_perimeter_data)
    }
}

// Position data for nozzle animation and rendering (enhanced for matrix calculation)
#[wasm_bindgen]
#[derive(Clone, Serialize, Deserialize)]
pub struct PositionData {
    // End position (current interface compatibility)
    x: f64,
    y: f64,
    z: f64,
    feed_rate: f64,
    extruding: bool,
    
    // Additional data for proper rendering (like TypeScript Move class)
    start_x: f64,
    start_y: f64,
    start_z: f64,
    length: f64,
    layer_height: f64,
    is_perimeter: bool,
    is_support: bool,
    
    // Color and selection data
    color: Color4,
    line_number: u32,
    file_position: u32,
    file_end_position: u32,
    tool: u32,
}

#[wasm_bindgen]
impl PositionData {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f64, y: f64, z: f64, feed_rate: f64, extruding: bool) -> PositionData {
        PositionData { 
            x, y, z, feed_rate, extruding,
            // Default values for backward compatibility
            start_x: x, start_y: y, start_z: z,
            length: 0.0, layer_height: 0.2, is_perimeter: true, is_support: false,
            color: Color4::white(), line_number: 0, file_position: 0, file_end_position: 0, tool: 0
        }
    }
    
    // Enhanced constructor for complete move data
    pub fn new_complete(
        start_x: f64, start_y: f64, start_z: f64,
        end_x: f64, end_y: f64, end_z: f64,
        feed_rate: f64, extruding: bool, layer_height: f64, is_perimeter: bool
    ) -> PositionData {
        let length = ((end_x - start_x).powi(2) + (end_y - start_y).powi(2) + (end_z - start_z).powi(2)).sqrt();
        
        PositionData { 
            x: end_x, y: end_y, z: end_z, 
            feed_rate, extruding,
            start_x, start_y, start_z,
            length, layer_height, is_perimeter, is_support: false,
            color: Color4::white(), line_number: 0, file_position: 0, file_end_position: 0, tool: 0
        }
    }

    // Enhanced constructor with move color data (internal use only)
    pub(crate) fn new_with_color(
        start_x: f64, start_y: f64, start_z: f64,
        end_x: f64, end_y: f64, end_z: f64,
        feed_rate: f64, extruding: bool, layer_height: f64, is_perimeter: bool,
        color: Color4, line_number: u32, file_position: u32, file_end_position: u32, tool: u32, is_support: bool
    ) -> PositionData {
        let length = ((end_x - start_x).powi(2) + (end_y - start_y).powi(2) + (end_z - start_z).powi(2)).sqrt();
        
        PositionData { 
            x: end_x, y: end_y, z: end_z, 
            feed_rate, extruding,
            start_x, start_y, start_z,
            length, layer_height, is_perimeter, is_support,
            color, line_number, file_position, file_end_position, tool
        }
    }
    
    // Getters for existing interface
    #[wasm_bindgen(getter)]
    pub fn x(&self) -> f64 { self.x }
    
    #[wasm_bindgen(getter)]
    pub fn y(&self) -> f64 { self.y }
    
    #[wasm_bindgen(getter)]
    pub fn z(&self) -> f64 { self.z }
    
    #[wasm_bindgen(getter)]
    pub fn feed_rate(&self) -> f64 { self.feed_rate }
    
    #[wasm_bindgen(getter)]
    pub fn extruding(&self) -> bool { self.extruding }
    
    // Additional getters for new data
    #[wasm_bindgen(getter)]
    pub fn start_x(&self) -> f64 { self.start_x }
    
    #[wasm_bindgen(getter)]
    pub fn start_y(&self) -> f64 { self.start_y }
    
    #[wasm_bindgen(getter)]
    pub fn start_z(&self) -> f64 { self.start_z }
    
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> f64 { self.length }
    
    #[wasm_bindgen(getter)]
    pub fn layer_height(&self) -> f64 { self.layer_height }
    
    #[wasm_bindgen(getter)]
    pub fn is_perimeter(&self) -> bool { self.is_perimeter }

    #[wasm_bindgen(getter)]
    pub fn line_number(&self) -> u32 { self.line_number }
    
    #[wasm_bindgen(getter)]
    pub fn file_position(&self) -> u32 { self.file_position }
    
    #[wasm_bindgen(getter)]
    pub fn file_end_position(&self) -> u32 { self.file_end_position }
    
    #[wasm_bindgen(getter)]
    pub fn tool(&self) -> u32 { self.tool }
}

// Main G-code processor class
#[wasm_bindgen]
pub struct GCodeProcessor {
    processor: FileProcessor,
    position_tracker: HashMap<u32, PositionData>,
    sorted_positions: Vec<u32>,
    render_segments: Vec<PositionData>,
}

#[wasm_bindgen]
impl GCodeProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> GCodeProcessor {
        console_log!("Creating new GCodeProcessor");

        GCodeProcessor {
            processor: FileProcessor::new(),
            position_tracker: HashMap::new(),
            sorted_positions: Vec::new(),
            render_segments: Vec::new(),
        }
    }

    /// Process G-code file and return results
    #[wasm_bindgen]
    pub fn process_file(&mut self,
                       file_content: &str,
                       progress_callback: Option<ProgressCallback>) -> ProcessingResult {
        let start_time = js_sys::Date::now();

        console_log!("Starting to process file with {} bytes", file_content.len());

        // Clear previous data
        self.clear_data();

        // Process the file
        match self.processor.process_file_content(file_content, progress_callback) {
            Ok((gcode_lines, positions, render_segments)) => {
                // Store position data
                self.position_tracker = positions;
                self.render_segments = render_segments;

                // Sort positions for animation
                self.sorted_positions = self.position_tracker.keys().cloned().collect();
                self.sorted_positions.sort();

                let processing_time = js_sys::Date::now() - start_time;

                console_log!("File processing completed: {} lines, {} positions, {:.2}ms",
                           gcode_lines.len(), self.position_tracker.len(), processing_time);

                ProcessingResult {
                    success: true,
                    error_message: String::new(),
                    line_count: gcode_lines.len(),
                    move_count: self.position_tracker.len(),
                    processing_time_ms: processing_time,
                }
            }
            Err(error) => {
                console_log!("File processing failed: {}", error);

                ProcessingResult {
                    success: false,
                    error_message: error,
                    line_count: 0,
                    move_count: 0,
                    processing_time_ms: js_sys::Date::now() - start_time,
                }
            }
        }
    }

    /// All tracked positions as one packed buffer, sorted by file position:
    /// [file_position, x, y, z, feed_rate, extruding] per entry. One boundary crossing instead of
    /// one wasm object per move
    #[wasm_bindgen]
    pub fn get_position_buffer(&self) -> Vec<f64> {
        let mut buffer = Vec::with_capacity(self.sorted_positions.len() * 6);
        for &position in &self.sorted_positions {
            if let Some(pos) = self.position_tracker.get(&position) {
                buffer.push(position as f64);
                buffer.push(pos.x);
                buffer.push(pos.y);
                buffer.push(pos.z);
                buffer.push(pos.feed_rate);
                buffer.push(if pos.extruding { 1.0 } else { 0.0 });
            }
        }
        buffer
    }

    /// Free the parsed data once JS has copied everything it needs. Linear memory never shrinks,
    /// but this lets the next load reuse the space instead of growing further
    #[wasm_bindgen]
    pub fn clear_data(&mut self) {
        self.position_tracker = HashMap::new();
        self.sorted_positions = Vec::new();
        self.render_segments = Vec::new();
    }

    /// Generate render buffers for fast mesh creation in JavaScript
    #[wasm_bindgen]
    pub fn generate_render_buffers(&self, nozzle_size: f32, padding: f32, progress_callback: Option<ProgressCallback>) -> RenderBuffers {
        let start_time = js_sys::Date::now();
        console_log!("Generating render buffers for {} segments", self.render_segments.len());

        // Pre-allocate vectors with estimated capacity
        let capacity = self.render_segments.len();
        let mut matrix_data = Vec::with_capacity(capacity * 16); // 4x4 matrix = 16 floats
        let mut color_data = Vec::with_capacity(capacity * 4);   // RGBA = 4 floats
        let mut pick_data = Vec::with_capacity(capacity * 3);   // RGB = 3 floats per segment
        let mut file_position_data = Vec::with_capacity(capacity);
        let mut file_end_position_data = Vec::with_capacity(capacity);
        let mut tool_data = Vec::with_capacity(capacity);
        let mut feed_rate_data = Vec::with_capacity(capacity);
        let mut is_perimeter_data = Vec::with_capacity(capacity);

        let mut segment_count = 0u32;
        let total_segments = self.render_segments.len();
        let mut processed_segments = 0usize;
        let mut last_progress_report = 0f64;

        // render_segments is already in file order and contains every tessellated arc piece
        for pos_data in &self.render_segments {
            processed_segments += 1;

            // Zero-length moves (E-only retracts/recoveries) have no direction; rendering them
            // would place unit-scale boxes at the seam positions
            if pos_data.length < 1e-9 {
                continue;
            }

            // Calculate matrix components (equivalent to TypeScript renderLine())
            let (matrix, color) = self.calculate_render_matrix(pos_data, nozzle_size, padding);

            // Add matrix data (16 floats for 4x4 matrix in column-major order)
            matrix_data.extend_from_slice(&matrix);

            // Add color data (RGBA)
            color_data.extend_from_slice(&color);

            // Add other buffer data
            let color_id = Self::num_to_color(pos_data.line_number);
            pick_data.extend_from_slice(&color_id); // RGB color for picking (matches TypeScript colorId/255)
            file_position_data.push(pos_data.file_position as f32);
            file_end_position_data.push(pos_data.file_end_position as f32);
            tool_data.push(pos_data.tool as f32);
            feed_rate_data.push(pos_data.feed_rate as f32);
            is_perimeter_data.push(if pos_data.is_perimeter { 1.0 } else { 0.0 });

            segment_count += 1;

            // Report progress every 5% or every 10000 segments to avoid callback overhead
            if processed_segments % 10000 == 0 || processed_segments % (total_segments / 20).max(1) == 0 {
                let progress = processed_segments as f64 / total_segments as f64;

                // Only report if progress changed significantly
                if progress - last_progress_report >= 0.05 {
                    if let Some(ref callback) = progress_callback {
                        callback.call(progress.min(1.0), "Building render objects");
                    }
                    last_progress_report = progress;
                }
            }
        }

        let processing_time = js_sys::Date::now() - start_time;
        console_log!("Generated {} render segments in {:.2}ms", segment_count, processing_time);

        // Report completion
        if let Some(ref callback) = progress_callback {
            callback.call(1.0, "Render objects complete");
        }

        RenderBuffers {
            matrix_data,
            color_data,
            pick_data,
            file_position_data,
            file_end_position_data,
            tool_data,
            feed_rate_data,
            is_perimeter_data,
            segment_count,
        }
    }

    // Helper function to calculate render matrix (equivalent to Move.renderLine())
    fn calculate_render_matrix(&self, pos_data: &PositionData, nozzle_size: f32, padding: f32) -> ([f32; 16], [f32; 4]) {
        // Replicate TypeScript Move.renderLine() logic exactly
        
        // Calculate length with padding (matches TypeScript: const length = this.length + padding * 0.1)
        let length = pos_data.length as f32 + padding * 0.1;
        
        // Calculate midpoint (matches TypeScript: Move.divide(Move.add(this.start, this.end), VECDIV2))
        let mid_x = (pos_data.start_x + pos_data.x) / 2.0;
        let mid_y = (pos_data.start_y + pos_data.y) / 2.0; 
        let mid_z = (pos_data.start_z + pos_data.z) / 2.0;
        
        // Calculate direction vector (matches TypeScript: Move.subtract(this.end, this.start))
        let v_x = pos_data.x - pos_data.start_x;
        let v_y = pos_data.y - pos_data.start_y;
        let v_z = pos_data.z - pos_data.start_z;
        
        // Calculate magnitude r (matches TypeScript: Math.sqrt(Math.pow(v[0], 2) + Math.pow(v[1], 2) + Math.pow(v[2], 2)))
        let r = (v_x * v_x + v_y * v_y + v_z * v_z).sqrt();
        
        // Avoid division by zero
        if r < f64::EPSILON {
            // Create identity matrix with translation only
            let matrix = [
                1.0, 0.0, 0.0, 0.0,
                0.0, 1.0, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                mid_x as f32, mid_y as f32, mid_z as f32, 1.0,
            ];
            let color = [
                pos_data.color.r as f32,
                pos_data.color.g as f32,
                pos_data.color.b as f32,
                pos_data.color.a as f32,
            ];
            return (matrix, color);
        }
        
        // Calculate rotation angles (matches TypeScript)
        let phi = v_z.atan2(v_x);        // TypeScript: Math.atan2(v[2], v[0])
        let theta = (v_y / r).acos();    // TypeScript: Math.acos(v[1] / r)
        
        const PI_OVER_2: f64 = std::f64::consts::PI / 2.0;
        
        // Create Euler rotation angles (matches TypeScript: new Vector3(0, -phi, PIOVER2 - theta))
        let euler_x: f64 = 0.0;
        let euler_y: f64 = -phi;
        let euler_z: f64 = PI_OVER_2 - theta;
        
        // Convert to quaternion and then to matrix (like Babylon.js Matrix.Compose does)
        // Quaternion from Euler angles (X, Y, Z order)
        let (sx, cx) = (euler_x / 2.0).sin_cos();
        let (sy, cy) = (euler_y / 2.0).sin_cos();
        let (sz, cz) = (euler_z / 2.0).sin_cos();
        
        // Quaternion components
        let qx = sx * cy * cz + cx * sy * sz;
        let qy = cx * sy * cz - sx * cy * sz;
        let qz = cx * cy * sz + sx * sy * cz;
        let qw = cx * cy * cz - sx * sy * sz;
        
        // Convert quaternion to rotation matrix
        let xx = qx * qx;
        let yy = qy * qy;
        let zz = qz * qz;
        let xy = qx * qy;
        let xz = qx * qz;
        let yz = qy * qz;
        let wx = qw * qx;
        let wy = qw * qy;
        let wz = qw * qz;
        
        // Rotation matrix from quaternion
        let r00 = 1.0 - 2.0 * (yy + zz);
        let r01 = 2.0 * (xy - wz);
        let r02 = 2.0 * (xz + wy);
        
        let r10 = 2.0 * (xy + wz);
        let r11 = 1.0 - 2.0 * (xx + zz);
        let r12 = 2.0 * (yz - wx);
        
        let r20 = 2.0 * (xz - wy);
        let r21 = 2.0 * (yz + wx);
        let r22 = 1.0 - 2.0 * (xx + yy);
        
        // Scale factors (matches TypeScript: new Vector3(length, this.layerHeight, nozzleSize))
        let scale_x = length as f64;
        let scale_y = pos_data.layer_height;
        let scale_z = nozzle_size as f64;
        
        // Compose transformation matrix exactly like Babylon.js Matrix.Compose(scale, rotation, translation)
        // Matrix is in column-major order for OpenGL/WebGL compatibility
        let matrix = [
            // Column 0 (X axis) - scale_x applied to rotated X basis vector
            (r00 * scale_x) as f32,
            (r10 * scale_x) as f32, 
            (r20 * scale_x) as f32,
            0.0,
            
            // Column 1 (Y axis) - scale_y applied to rotated Y basis vector
            (r01 * scale_y) as f32,
            (r11 * scale_y) as f32,
            (r21 * scale_y) as f32, 
            0.0,
            
            // Column 2 (Z axis) - scale_z applied to rotated Z basis vector
            (r02 * scale_z) as f32,
            (r12 * scale_z) as f32,
            (r22 * scale_z) as f32,
            0.0,
            
            // Column 3 (Translation vector) - applied after scale and rotation
            // Coordinates are now correct from the fixed parsing
            mid_x as f32, mid_y as f32, mid_z as f32, 1.0,
        ];
        
        // Use the actual move color (matches TypeScript: p.Color = this.color)
        let color = [
            pos_data.color.r as f32,
            pos_data.color.g as f32,
            pos_data.color.b as f32,
            pos_data.color.a as f32,
        ];
        
        (matrix, color)
    }
    
    // Convert line number to RGB color for picking (matches TypeScript numToColor)
    // Returns normalized float values (0.0-1.0) to match TypeScript pickData format
    fn num_to_color(line_number: u32) -> [f32; 3] {
        [
            (((line_number >> 16) & 0xFF) as f32) / 255.0,  // Red channel / 255
            (((line_number >> 8) & 0xFF) as f32) / 255.0,   // Green channel / 255
            ((line_number & 0xFF) as f32) / 255.0,          // Blue channel / 255
        ]
    }
}

// Export version information
#[wasm_bindgen]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
