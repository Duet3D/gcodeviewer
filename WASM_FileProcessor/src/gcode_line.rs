use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Vector3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vector3 {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
    
    pub fn zero() -> Self {
        Self::new(0.0, 0.0, 0.0)
    }
    
    pub fn distance(&self, other: &Vector3) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        let dz = self.z - other.z;
        (dx * dx + dy * dy + dz * dz).sqrt()
    }
    
    pub fn to_array(&self) -> [f64; 3] {
        [self.x, self.y, self.z]
    }
    
    pub fn from_array(arr: &[f64; 3]) -> Self {
        Self::new(arr[0], arr[1], arr[2])
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Color4 {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

impl Color4 {
    pub fn new(r: f64, g: f64, b: f64, a: f64) -> Self {
        Self { r, g, b, a }
    }
    
    pub fn white() -> Self {
        Self::new(1.0, 1.0, 1.0, 1.0)
    }
    
    pub fn to_array(&self) -> [f64; 4] {
        [self.r, self.g, self.b, self.a]
    }
}

// Base G-code line trait - all G-code lines implement this
pub trait GCodeLineBase {
    fn line_type(&self) -> LineType;
    fn file_position(&self) -> u32;
    fn line_number(&self) -> u32;
    fn original_line(&self) -> &str;
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum LineType {
    Move,        // 'L' - Linear move
    Arc,         // 'A' - Arc move  
    Travel,      // 'T' - Travel move (non-extruding)
    Comment,     // 'C' - Comment line
    Command,     // 'G' - G-code command
    MCode,       // 'M' - M-code command
    Tool,        // 'T' - Tool/temperature command
}

// Enum representing all possible G-code line types
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum GCodeLine {
    Move(MoveData),
    Arc(ArcMove),
    Comment(CommentData),
    Command(CommandData),
    MCode(MCodeData),
    Tool(ToolCommand),
}

impl GCodeLineBase for GCodeLine {
    fn line_type(&self) -> LineType {
        match self {
            GCodeLine::Move(m) => if m.extruding { LineType::Move } else { LineType::Travel },
            GCodeLine::Arc(_) => LineType::Arc,
            GCodeLine::Comment(_) => LineType::Comment,
            GCodeLine::Command(_) => LineType::Command,
            GCodeLine::MCode(_) => LineType::MCode,
            GCodeLine::Tool(_) => LineType::Tool,
        }
    }
    
    fn file_position(&self) -> u32 {
        match self {
            GCodeLine::Move(m) => m.file_position,
            GCodeLine::Arc(a) => a.file_position,
            GCodeLine::Comment(c) => c.file_position,
            GCodeLine::Command(cmd) => cmd.file_position,
            GCodeLine::MCode(m) => m.file_position,
            GCodeLine::Tool(t) => t.file_position,
        }
    }
    
    fn line_number(&self) -> u32 {
        match self {
            GCodeLine::Move(m) => m.line_number,
            GCodeLine::Arc(a) => a.line_number,
            GCodeLine::Comment(c) => c.line_number,
            GCodeLine::Command(cmd) => cmd.line_number,
            GCodeLine::MCode(m) => m.line_number,
            GCodeLine::Tool(t) => t.line_number,
        }
    }
    
    fn original_line(&self) -> &str {
        match self {
            GCodeLine::Move(m) => &m.original_line,
            GCodeLine::Arc(a) => &a.original_line,
            GCodeLine::Comment(c) => &c.original_line,
            GCodeLine::Command(cmd) => &cmd.original_line,
            GCodeLine::MCode(m) => &m.original_line,
            GCodeLine::Tool(t) => &t.original_line,
        }
    }
}

// Move command data (G0/G1)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MoveData {
    pub file_position: u32,
    pub line_number: u32,
    pub original_line: String,
    pub tool: u8,
    pub start: Vector3,
    pub end: Vector3,
    pub extruding: bool,
    pub color: Color4,
    pub feed_rate: f64,
    pub layer_height: f64,
    pub is_perimeter: bool,
    pub is_support: bool,
    pub color_id: [u8; 3], // RGB color ID for picking
}

impl MoveData {
    pub fn new(file_position: u32, line_number: u32, original_line: String) -> Self {
        Self {
            file_position,
            line_number,
            original_line,
            tool: 0,
            start: Vector3::zero(),
            end: Vector3::zero(),
            extruding: false,
            color: Color4::white(),
            feed_rate: 1500.0,
            layer_height: 0.2,
            is_perimeter: false,
            is_support: false,
            color_id: [0, 0, 0],
        }
    }
    
    pub fn length(&self) -> f64 {
        self.start.distance(&self.end)
    }
    
    // Get direction vector
    pub fn direction(&self) -> Vector3 {
        Vector3::new(
            self.end.x - self.start.x,
            self.end.y - self.start.y,
            self.end.z - self.start.z,
        )
    }
}

// Arc move data (G2/G3)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArcMove {
    pub file_position: u32,
    pub line_number: u32,
    pub original_line: String,
    pub tool: u8,
    pub start: Vector3,
    pub end: Vector3,
    pub center: Vector3,
    // The raw R parameter when specified; arcs defined via I/J/K offsets carry None
    pub radius: Option<f64>,
    pub clockwise: bool,
    pub extruding: bool,
    pub color: Color4,
    pub feed_rate: f64,
    pub segments: Vec<MoveData>, // Arc broken down into line segments
}

impl ArcMove {
    pub fn new(file_position: u32, line_number: u32, original_line: String) -> Self {
        Self {
            file_position,
            line_number,
            original_line,
            tool: 0,
            start: Vector3::zero(),
            end: Vector3::zero(),
            center: Vector3::zero(),
            radius: None,
            clockwise: false,
            extruding: false,
            color: Color4::white(),
            feed_rate: 1500.0,
            segments: Vec::new(),
        }
    }
}

// Comment line data
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommentData {
    pub file_position: u32,
    pub line_number: u32,
    pub original_line: String,
    pub comment_text: String,
}

impl CommentData {
    pub fn new(file_position: u32, line_number: u32, original_line: String) -> Self {
        let comment_text = if original_line.starts_with(';') {
            original_line[1..].trim().to_string()
        } else {
            original_line.trim().to_string()
        };
        
        Self {
            file_position,
            line_number,
            original_line,
            comment_text,
        }
    }
}

// Generic command data (G-codes other than moves)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandData {
    pub file_position: u32,
    pub line_number: u32,
    pub original_line: String,
    pub command_type: String,
    pub parameters: Vec<(String, f64)>, // Parameter name and value pairs
}

impl CommandData {
    pub fn new(file_position: u32, line_number: u32, original_line: String, command_type: String) -> Self {
        Self {
            file_position,
            line_number,
            original_line,
            command_type,
            parameters: Vec::new(),
        }
    }
}

// M-code command data
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MCodeData {
    pub file_position: u32,
    pub line_number: u32,
    pub original_line: String,
    pub mcode_number: u32,
    pub parameters: Vec<(String, f64)>, // Parameter name and value pairs
}

impl MCodeData {
    pub fn new(file_position: u32, line_number: u32, original_line: String, mcode_number: u32) -> Self {
        Self {
            file_position,
            line_number,
            original_line,
            mcode_number,
            parameters: Vec::new(),
        }
    }
}

// Utility functions for creating G-code lines
impl GCodeLine {
    pub fn new_move(file_position: u32, line_number: u32, original_line: String) -> Self {
        GCodeLine::Move(MoveData::new(file_position, line_number, original_line))
    }
    
    pub fn new_arc(file_position: u32, line_number: u32, original_line: String) -> Self {
        GCodeLine::Arc(ArcMove::new(file_position, line_number, original_line))
    }
    
    pub fn new_comment(file_position: u32, line_number: u32, original_line: String) -> Self {
        GCodeLine::Comment(CommentData::new(file_position, line_number, original_line))
    }
    
    pub fn new_command(file_position: u32, line_number: u32, original_line: String, command_type: String) -> Self {
        GCodeLine::Command(CommandData::new(file_position, line_number, original_line, command_type))
    }
    
    pub fn new_mcode(file_position: u32, line_number: u32, original_line: String, mcode_number: u32) -> Self {
        GCodeLine::MCode(MCodeData::new(file_position, line_number, original_line, mcode_number))
    }
}

// Helper functions for pattern matching
impl GCodeLine {
    pub fn as_move(&self) -> Option<&MoveData> {
        match self {
            GCodeLine::Move(m) => Some(m),
            _ => None,
        }
    }
    
    pub fn as_move_mut(&mut self) -> Option<&mut MoveData> {
        match self {
            GCodeLine::Move(m) => Some(m),
            _ => None,
        }
    }
    
    pub fn as_arc(&self) -> Option<&ArcMove> {
        match self {
            GCodeLine::Arc(a) => Some(a),
            _ => None,
        }
    }
    
    pub fn as_comment(&self) -> Option<&CommentData> {
        match self {
            GCodeLine::Comment(c) => Some(c),
            _ => None,
        }
    }
    
    pub fn is_extruding_move(&self) -> bool {
        match self {
            GCodeLine::Move(m) => m.extruding,
            GCodeLine::Arc(a) => a.extruding,
            _ => false,
        }
    }
}

// Tool command data (T-codes, M104/M109, M140/M190, etc.)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCommand {
    pub file_position: u32,
    pub line_number: u32,
    pub original_line: String,
    pub command_type: String, // "TOOL_CHANGE", "SET_HOTEND_TEMP", etc.
    pub tool_number: Option<u32>,
    pub temperature: Option<f64>,
    pub wait_for_temperature: bool,
}

impl ToolCommand {
    pub fn new(
        file_position: u32,
        line_number: u32,
        original_line: String,
        command_type: String,
    ) -> Self {
        Self {
            file_position,
            line_number,
            original_line,
            command_type,
            tool_number: None,
            temperature: None,
            wait_for_temperature: false,
        }
    }
}