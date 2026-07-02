import ProcessorProperties from '../processorproperties'
import { Comment } from '../GCodeLines'

export default function g29(props: ProcessorProperties, line: string) {
   // G29 - Auto Bed Leveling
   // This command probes the bed and sets up automatic bed leveling
   
   props.bedLevelingActive = true
   
   const comment = new Comment(props, line)
   comment.comment = `Auto bed leveling probe (${line.trim()})`
   
   return comment
}