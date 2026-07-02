import ProcessorProperties from '../processorproperties'
import { Comment } from '../GCodeLines'

export function m17(props: ProcessorProperties, line: string) {
   // M17 - Enable/Power all stepper motors
   const comment = new Comment(props, line)
   comment.comment = `Enable all stepper motors (${line.trim()})`
   
   return comment
}

export function m82(props: ProcessorProperties, line: string) {
   // M82 - Set extruder to absolute mode
   props.extruderAbsolute = true
   
   const comment = new Comment(props, line)
   comment.comment = `Set extruder to absolute mode (${line.trim()})`
   
   return comment
}

export function m83(props: ProcessorProperties, line: string) {
   // M83 - Set extruder to relative mode
   props.extruderAbsolute = false
   
   const comment = new Comment(props, line)
   comment.comment = `Set extruder to relative mode (${line.trim()})`
   
   return comment
}

export function m84(props: ProcessorProperties, line: string) {
   // M84 - Disable steppers (or set timeout)
   const comment = new Comment(props, line)
   comment.comment = `Disable steppers ${line.includes('S') ? 'with timeout' : ''} (${line.trim()})`
   
   return comment
}

export function m92(props: ProcessorProperties, line: string) {
   // M92 - Set axis steps-per-unit
   const comment = new Comment(props, line)
   comment.comment = `Set axis steps per unit (${line.trim()})`
   
   return comment
}