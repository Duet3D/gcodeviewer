import { Base, Comment } from '../GCodeLines'
import Props from '../processorproperties'
import Tool, { tools as defaultTools } from '../tools'

const toolRegex = /^[T]-?[0-9]+/g

export default function (props: Props, line: string): Base {
   // A leading Tnn is a tool change; anything else (e.g. a Tnn parameter inside an M98 macro call)
   // is not, so treat it as a plain comment rather than dereferencing a null match
   const match = line.match(toolRegex)
   if (match === null) {
      return new Comment(props, line)
   }
   let toolIdx = Number(match[0].substring(1).trim())
   if (toolIdx < 0) {
      toolIdx = 0
   }
   // Files may select tools beyond the configured table; extend it (cycling the default palette)
   // instead of leaving currentTool undefined and crashing the next Move
   while (props.tools.length <= toolIdx) {
      props.tools.push(new Tool(props.tools.length, defaultTools[props.tools.length % defaultTools.length].color))
   }
   props.currentTool = props.tools[toolIdx]
   return new Comment(props, line)
}
