use crate::slicers::{SlicerBase, FeatureType, LayerInfo};
use crate::gcode_line::Color4;

pub struct PrusaSlicer {
    name: String,
}

impl PrusaSlicer {
    pub fn new() -> Self {
        Self {
            name: "PrusaSlicer".to_string(),
        }
    }
}

impl SlicerBase for PrusaSlicer {
    fn get_feature_color(&self, feature: &FeatureType) -> Color4 {
        // Colors exactly matching TypeScript featureList values
        match feature {
            FeatureType::Perimeter => Color4::new(1.0, 0.9, 0.3, 1.0), // [1, 0.9, 0.3, 1]
            FeatureType::ExternalPerimeter => Color4::new(1.0, 0.5, 0.2, 1.0), // [1, 0.5, 0.2, 1]
            FeatureType::Infill => Color4::new(0.59, 0.19, 0.16, 1.0), // [0.59, 0.19, 0.16, 1] - INTERNAL INFILL
            FeatureType::SolidInfill => Color4::new(0.59, 0.19, 0.8, 1.0), // [0.59, 0.19, 0.8, 1]
            FeatureType::TopSolidInfill => Color4::new(0.95, 0.25, 0.25, 1.0), // [0.95, 0.25, 0.25, 1]
            FeatureType::BridgeInfill => Color4::new(0.3, 0.5, 0.73, 1.0), // [0.3, 0.5, 0.73, 1]
            FeatureType::GapFill => Color4::new(1.0, 1.0, 1.0, 1.0), // [1, 1, 1, 1]
            FeatureType::Skirt => Color4::new(0.0, 0.53, 0.43, 1.0), // [0, 0.53, 0.43, 1]
            FeatureType::Brim => Color4::new(0.0, 0.53, 0.43, 1.0), // [0, 0.53, 0.43, 1] - SKIRT/BRIM
            FeatureType::Support => Color4::new(0.5, 0.5, 0.5, 1.0), // [0.5, 0.5, 0.5, 1] - SUPPORT MATERIAL
            FeatureType::SupportInterface => Color4::new(0.5, 0.5, 0.5, 1.0), // [0.5, 0.5, 0.5, 1]
            FeatureType::WipeTower => Color4::new(0.5, 0.5, 0.5, 1.0), // [0.5, 0.5, 0.5, 1]
            _ => Color4::new(0.5, 0.5, 0.5, 1.0), // [0.5, 0.5, 0.5, 1] - CUSTOM/UNKNOWN
        }
    }
    
    fn parse_feature_from_comment(&self, comment: &str) -> Option<FeatureType> {
        // Extract feature from ;TYPE: comments (matches TypeScript exactly)
        let c = comment.trim();
        if c.starts_with(";TYPE:") {
            let feature_name = c[6..].trim().to_uppercase(); // Skip ";TYPE:" and trim

            // Direct lookup matching TypeScript featureList exactly
            match feature_name.as_str() {
                "PERIMETER" => Some(FeatureType::Perimeter),
                "EXTERNAL PERIMETER" => Some(FeatureType::ExternalPerimeter),
                "INTERNAL INFILL" => Some(FeatureType::Infill),
                "SOLID INFILL" => Some(FeatureType::SolidInfill),
                "TOP SOLID INFILL" => Some(FeatureType::TopSolidInfill),
                "BRIDGE INFILL" => Some(FeatureType::BridgeInfill),
                "GAP FILL" => Some(FeatureType::GapFill),
                "SKIRT" => Some(FeatureType::Skirt),
                "SKIRT/BRIM" => Some(FeatureType::Brim),
                "SUPPORTED MATERIAL" => Some(FeatureType::Support),
                "SUPPORTED MATERIAL INTERFACE" => Some(FeatureType::SupportInterface),
                "SUPPORT MATERIAL" => Some(FeatureType::Support),
                "SUPPORT MATERIAL INTERFACE" => Some(FeatureType::SupportInterface),
                "OVERHANG PERIMETER" => Some(FeatureType::Perimeter), // Map to Perimeter
                "WIPE TOWER" => Some(FeatureType::WipeTower),
                "CUSTOM" => Some(FeatureType::Perimeter), // Default to Perimeter for now
                "UNKNOWN" => Some(FeatureType::Perimeter), // Default to Perimeter for now
                _ => None, // Unknown feature type
            }
        } else {
            None
        }
    }
    
    fn parse_layer_info(&self, comment: &str) -> Option<LayerInfo> {
        // PrusaSlicer format: "; LAYER_CHANGE\n; Z:0.3\n; layer num/total_layer_count: 1/245"
        if comment.contains("LAYER_CHANGE") || comment.starts_with("; Z:") {
            if let Some(z_start) = comment.find("; Z:") {
                let z_line = &comment[z_start + 4..];
                if let Some(z_end) = z_line.find('\n').or_else(|| Some(z_line.len())) {
                    let z_str = z_line[..z_end].trim();
                    if let Ok(z_pos) = z_str.parse::<f64>() {
                        // Try to find layer number
                        let layer_num = if let Some(layer_start) = comment.find("layer num/total_layer_count: ") {
                            let layer_line = &comment[layer_start + 29..];
                            if let Some(slash_pos) = layer_line.find('/') {
                                layer_line[..slash_pos].trim().parse::<u32>().unwrap_or(0)
                            } else {
                                0
                            }
                        } else {
                            0
                        };
                        
                        return Some(LayerInfo {
                            layer_number: layer_num,
                            layer_height: 0.2, // Default, could parse from settings
                            z_position: z_pos,
                        });
                    }
                }
            }
        }
        None
    }
    
    fn is_perimeter_comment(&self, comment: &str) -> bool {
        // Match TypeScript featureList perimeter flags exactly
        if let Some(feature) = self.parse_feature_from_comment(comment) {
            match feature {
                FeatureType::ExternalPerimeter => true,  // perimeter: true
                FeatureType::TopSolidInfill => true,     // perimeter: true  
                FeatureType::WipeTower => true,          // perimeter: true
                _ => false,                              // perimeter: false for all others
            }
        } else {
            false
        }
    }
    
    fn is_support_comment(&self, comment: &str) -> bool {
        // Match TypeScript featureList support flags exactly  
        if let Some(feature) = self.parse_feature_from_comment(comment) {
            match feature {
                FeatureType::Support => true,           // support: true (SUPPORTED MATERIAL, SUPPORT MATERIAL)
                FeatureType::SupportInterface => true,  // support: true (SUPPORTED/SUPPORT MATERIAL INTERFACE)
                _ => false,                              // support: false for all others
            }
        } else {
            false
        }
    }
    
    fn get_temperature_from_comment(&self, comment: &str) -> Option<f64> {
        // Look for temperature settings in comments
        if comment.contains("temperature") {
            // Extract numeric value after "temperature"
            if let Some(temp_start) = comment.find("temperature") {
                let temp_substr = &comment[temp_start..]; 
                for word in temp_substr.split_whitespace() {
                    if let Ok(temp) = word.trim_matches(&[';', '°', 'C', '=', ':'][..]).parse::<f64>() {
                        if temp > 0.0 && temp < 500.0 { // Reasonable temperature range
                            return Some(temp);
                        }
                    }
                }
            }
        }
        None
    }
    
    fn detect_slicer(file_content: &str) -> bool where Self: Sized {
        // preFlight is a PrusaSlicer fork - same TYPE comments and feature palette, so it uses the
        // PrusaSlicer parser rather than falling through to the near-monochrome generic slicer
        file_content.contains("; generated by PrusaSlicer") || file_content.contains("; generated by preFlight")
    }
    
    fn get_name(&self) -> &str {
        &self.name
    }
    
    fn get_version_info(&self, file_content: &str) -> Option<String> {
        // Extract PrusaSlicer version: "; generated by PrusaSlicer 2.6.0+win64 on 2023-04-15 at 14:30:25 UTC"
        if let Some(start) = file_content.find("; generated by PrusaSlicer ") {
            let version_line = &file_content[start + 27..];
            if let Some(end) = version_line.find(" on ").or_else(|| version_line.find('\n')) {
                return Some(version_line[..end].trim().to_string());
            }
        }
        None
    }
}

impl Default for PrusaSlicer {
    fn default() -> Self {
        Self::new()
    }
}
