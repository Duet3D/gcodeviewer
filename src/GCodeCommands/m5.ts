import ProcessorProperties from '../processorproperties'
import { Comment } from '../GCodeLines'

export default function m5(props: ProcessorProperties, line: string) {
   // M5 - Spindle Stop
   
   props.spindleSpeed = 0
   props.spindleOn = false
   
   const comment = new Comment(props, line)
   comment.comment = `Spindle stop (${line.trim()})`
   
   return comment
}