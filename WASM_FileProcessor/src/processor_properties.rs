use crate::gcode_line::{Vector3, Color4};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ColorMode {
    Tool,
    Feature,
    FeedRate,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ArcPlane {
    XY,
    XZ,
    YZ,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Units {
    Millimeters,
    Inches,
}

// Tool information
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Tool {
    pub tool_number: u8,
    pub color: Color4,
    pub diameter: f64,
    pub temperature: f64,
    pub name: String,
}

impl Tool {
    pub fn new(tool_number: u8) -> Self {
        Self {
            tool_number,
            color: Color4::white(),
            diameter: 0.4,
            temperature: 200.0,
            name: format!("Tool {}", tool_number),
        }
    }
    
    pub fn default() -> Self {
        Self::new(0)
    }
}

// Workplace offset information
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkplaceOffset {
    pub index: u8,
    pub offset: Vector3,
    pub name: String,
}

impl WorkplaceOffset {
    pub fn new(index: u8) -> Self {
        Self {
            index,
            offset: Vector3::zero(),
            name: format!("G5{}", index + 4), // G54, G55, etc.
        }
    }
}

// Main processor properties struct - mirrors TypeScript ProcessorProperties
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProcessorProperties {
    // Height tracking
    pub max_height: f64,
    pub min_height: f64,
    
    // File tracking
    pub line_count: u32,
    pub file_position: u32,
    pub line_number: u32,
    pub first_gcode_byte: u32,
    pub last_gcode_byte: u32,
    
    // Layer tracking
    pub layer_dictionary: HashMap<u32, u32>, // Z-height hash -> line count
    pub previous_z: f64, // Last Z where extrusion occurred
    
    // Tool management
    pub tools: Vec<Tool>,
    pub current_tool: Tool,
    
    // Position tracking
    pub current_position: Vector3,
    pub current_feed_rate: f64,
    pub max_feed_rate: f64,
    pub min_feed_rate: f64,
    
    // Extrusion tracking
    pub current_e: f64,
    pub total_extrusion: f64,
    pub absolute_extrusion: bool,
    
    // Temperature tracking
    pub target_hotend_temp: f64,
    pub target_bed_temp: f64,
    pub current_hotend_temp: f64,
    pub current_bed_temp: f64,
    
    // Stepper and hardware state
    pub steppers_enabled: bool,
    pub steps_per_mm_x: f64,
    pub steps_per_mm_y: f64,
    pub steps_per_mm_z: f64,
    pub steps_per_mm_e: f64,
    
    // Visual settings
    pub progress_color: Color4,
    pub progress_animation: bool,
    
    // Machine settings
    pub has_mixing: bool,
    pub current_workplace_idx: u8,
    pub workplace_offsets: Vec<WorkplaceOffset>,
    pub absolute_positioning: bool,
    pub firmware_retraction: bool,
    pub units: Units,
    pub cnc_mode: bool,
    pub z_belt: bool, // Special printer configuration
    
    // Arc settings
    pub fix_radius: bool,
    pub arc_plane: ArcPlane,
    
    // Rendering stats
    pub total_rendered_segments: u32,
    
    // Z-belt specific (for belt printers)
    pub current_z: f64,
    pub hyp: f64, // Hypotenuse for belt calculations
    pub adj: f64, // Adjacent for belt calculations
    
    // Slicer information
    pub slicer_name: String,
    pub slicer_version: String,
    
    // Current feature coloring state (updated by comment processing)
    pub current_feature_color: Color4,
    pub current_is_perimeter: bool,
    pub current_is_support: bool,
}

impl ProcessorProperties {
    pub fn new() -> Self {
        let mut tools = Vec::new();
        tools.push(Tool::default());
        
        let mut workplace_offsets = Vec::new();
        for i in 0..6 {
            workplace_offsets.push(WorkplaceOffset::new(i));
        }
        
        Self {
            max_height: 0.0,
            min_height: 0.0,
            line_count: 0,
            file_position: 0,
            line_number: 0,
            first_gcode_byte: 0,
            last_gcode_byte: 0,
            layer_dictionary: HashMap::new(),
            previous_z: 0.0,
            tools: tools.clone(),
            current_tool: tools[0].clone(),
            current_position: Vector3::zero(),
            current_feed_rate: 1500.0,
            max_feed_rate: 1.0,
            min_feed_rate: 999999999.0,
            current_e: 0.0,
            total_extrusion: 0.0,
            absolute_extrusion: true,
            target_hotend_temp: 0.0,
            target_bed_temp: 0.0,
            current_hotend_temp: 0.0,
            current_bed_temp: 0.0,
            steppers_enabled: true,
            steps_per_mm_x: 80.0,
            steps_per_mm_y: 80.0,
            steps_per_mm_z: 400.0,
            steps_per_mm_e: 420.0,
            progress_color: Color4::new(0.0, 1.0, 0.0, 1.0),
            progress_animation: true,
            has_mixing: false,
            current_workplace_idx: 0,
            workplace_offsets,
            absolute_positioning: true,
            firmware_retraction: false,
            units: Units::Millimeters,
            cnc_mode: false,
            z_belt: false,
            fix_radius: false,
            arc_plane: ArcPlane::XY,
            total_rendered_segments: 0,
            current_z: 0.0,
            hyp: 0.0,
            adj: 0.0,
            slicer_name: "Unknown".to_string(),
            slicer_version: "Unknown".to_string(),
            
            // Initialize with default feature colors (white)
            current_feature_color: Color4::white(),
            current_is_perimeter: false,
            current_is_support: false,
        }
    }
    
    // Get current workplace offset
    pub fn current_workplace(&self) -> &Vector3 {
        &self.workplace_offsets[self.current_workplace_idx as usize].offset
    }
    
    // Set gantry angle for Z-belt printers (in degrees)
    pub fn set_gantry_angle(&mut self, angle_degrees: f64) {
        let angle_radians = angle_degrees * std::f64::consts::PI / 180.0;
        self.hyp = angle_radians.cos();
        self.adj = angle_radians.tan();
    }
    
    // Initialize Z-belt calculations with default 45-degree angle
    pub fn init_z_belt(&mut self) {
        self.z_belt = true;
        self.set_gantry_angle(45.0); // Default angle
    }
    
    // Get current workplace offset (mutable)
    pub fn current_workplace_mut(&mut self) -> &mut Vector3 {
        &mut self.workplace_offsets[self.current_workplace_idx as usize].offset
    }
    
    // Set current tool by index
    pub fn set_current_tool(&mut self, tool_number: u8) {
        if let Some(tool) = self.tools.iter().find(|t| t.tool_number == tool_number) {
            self.current_tool = tool.clone();
        } else {
            // Create new tool if it doesn't exist
            let new_tool = Tool::new(tool_number);
            self.tools.push(new_tool.clone());
            self.current_tool = new_tool;
        }
    }
    
    // F is modal: it always updates the current feed rate, extruding or not
    pub fn set_feed_rate(&mut self, feed_rate: f64) {
        self.current_feed_rate = feed_rate;
    }

    // Min/max only cover feed rates used while extruding - travel rates would compress the
    // feed-rate color gradient into a fraction of its range
    pub fn record_extrusion_feed_rate(&mut self, feed_rate: f64) {
        if feed_rate > self.max_feed_rate {
            self.max_feed_rate = feed_rate;
        }
        if feed_rate > 0.0 && feed_rate < self.min_feed_rate {
            self.min_feed_rate = feed_rate;
        }
    }
    
    // Update height tracking
    pub fn update_height(&mut self, z: f64) {
        if z > self.max_height {
            self.max_height = z;
        }
        if z < self.min_height {
            self.min_height = z;
        }
    }
    
    // Set workspace by G-code (G54, G55, etc.)
    pub fn set_workspace(&mut self, gcode: &str) {
        match gcode {
            "G54" => self.current_workplace_idx = 0,
            "G55" => self.current_workplace_idx = 1,
            "G56" => self.current_workplace_idx = 2,
            "G57" => self.current_workplace_idx = 3,
            "G58" => self.current_workplace_idx = 4,
            "G59" => self.current_workplace_idx = 5,
            _ => {} // Unknown workspace, keep current
        }
    }
    
    // Build tool color array for rendering (matches TypeScript method)
    pub fn build_tool_float32_array(&self) -> Vec<f32> {
        let mut colors = Vec::with_capacity(self.tools.len() * 4);
        
        for tool in &self.tools {
            colors.push(tool.color.r as f32);
            colors.push(tool.color.g as f32);
            colors.push(tool.color.b as f32);
            colors.push(tool.color.a as f32);
        }
        
        colors
    }
    
    // Reset for new file processing. The processor instance persists across loads, so every piece
    // of modal parser state a file can change must be restored here or it bleeds into the next file
    pub fn reset(&mut self) {
        self.line_count = 0;
        self.file_position = 0;
        self.line_number = 0;
        self.first_gcode_byte = 0;
        self.last_gcode_byte = 0;
        self.layer_dictionary.clear();
        self.current_position = Vector3::zero();
        self.current_e = 0.0;
        self.total_extrusion = 0.0;
        self.previous_z = 0.0;
        self.total_rendered_segments = 0;
        self.max_height = 0.0;
        self.min_height = 0.0;
        self.max_feed_rate = 1.0;
        self.min_feed_rate = 999999999.0;
        self.current_feed_rate = 1500.0;
        self.current_z = 0.0;
        self.target_hotend_temp = 0.0;
        self.target_bed_temp = 0.0;
        self.current_hotend_temp = 0.0;
        self.current_bed_temp = 0.0;
        self.absolute_positioning = true;
        self.absolute_extrusion = true;
        self.firmware_retraction = false;
        self.units = Units::Millimeters;
        self.arc_plane = ArcPlane::XY;
        self.steppers_enabled = true;
        self.slicer_name = "Unknown".to_string();
        self.slicer_version = "Unknown".to_string();
        self.current_feature_color = Color4::white();
        self.current_is_perimeter = false;
        self.current_is_support = false;

        // Drop tools auto-created by previous files and reset to the default tool
        self.tools.truncate(1);
        if !self.tools.is_empty() {
            self.current_tool = self.tools[0].clone();
        }

        // Reset workspace to default
        self.current_workplace_idx = 0;
        for wp in &mut self.workplace_offsets {
            wp.offset = Vector3::zero();
        }
    }
    
    // Get units multiplier for conversion
    pub fn units_multiplier(&self) -> f64 {
        match self.units {
            Units::Millimeters => 1.0,
            Units::Inches => 25.4, // Convert inches to mm
        }
    }
    
    // Set units from G-code
    pub fn set_units(&mut self, gcode: &str) {
        match gcode {
            "G20" => self.units = Units::Inches,
            "G21" => self.units = Units::Millimeters,
            _ => {} // Unknown units, keep current
        }
    }
    
    // Set positioning mode from G-code
    pub fn set_positioning_mode(&mut self, gcode: &str) {
        match gcode {
            "G90" => self.absolute_positioning = true,
            "G91" => self.absolute_positioning = false,
            _ => {} // Unknown mode, keep current
        }
    }
}

impl Default for ProcessorProperties {
    fn default() -> Self {
        Self::new()
    }
}