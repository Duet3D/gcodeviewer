import ProcessorProperties from '../processorproperties'
import { Comment } from '../GCodeLines'

// Parse temperature parameter from line
function parseTemperature(line: string): number | null {
   const match = line.match(/S(\d+\.?\d*)/i)
   return match ? parseFloat(match[1]) : null
}

export function m104(props: ProcessorProperties, line: string) {
   // M104 - Set Hotend Temperature (no wait)
   const temp = parseTemperature(line)
   
   if (temp !== null) {
      props.currentTool.temperature = temp
   }
   
   const comment = new Comment(props, line)
   comment.comment = `Set hotend temperature to ${temp || 'auto'}°C (${line.trim()})`
   
   return comment
}

export function m109(props: ProcessorProperties, line: string) {
   // M109 - Set Hotend Temperature and Wait
   const temp = parseTemperature(line)
   
   if (temp !== null) {
      props.currentTool.temperature = temp
   }
   
   const comment = new Comment(props, line)
   comment.comment = `Set hotend temperature to ${temp || 'auto'}°C and wait (${line.trim()})`
   
   return comment
}

export function m140(props: ProcessorProperties, line: string) {
   // M140 - Set Bed Temperature (no wait)
   const temp = parseTemperature(line)
   
   if (temp !== null) {
      // Could add bed temperature tracking if needed
   }
   
   const comment = new Comment(props, line)
   comment.comment = `Set bed temperature to ${temp || 'auto'}°C (${line.trim()})`
   
   return comment
}

export function m190(props: ProcessorProperties, line: string) {
   // M190 - Set Bed Temperature and Wait
   const temp = parseTemperature(line)
   
   if (temp !== null) {
      // Could add bed temperature tracking if needed
   }
   
   const comment = new Comment(props, line)
   comment.comment = `Set bed temperature to ${temp || 'auto'}°C and wait (${line.trim()})`
   
   return comment
}