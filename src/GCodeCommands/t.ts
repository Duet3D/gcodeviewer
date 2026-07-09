import { Base, Comment } from '../GCodeLines'
import Props from '../processorproperties'

const toolRegex = /^[T]-?[0-9]+/g

export default function (props: Props, line: string): Base {
   // A leading Tnn is a tool change; anything else (e.g. a Tnn parameter inside an M98 macro call)
   // is not, so treat it as a plain comment rather than dereferencing a null match
   const match = line.match(toolRegex)
   if (match === null) {
      return new Comment(props, line)
   }
   let toolIdx = Number(match[0].substring(1).trim())
   if (toolIdx == -1) {
      toolIdx = 0
   }
   props.currentTool = props.tools[toolIdx]
   return new Comment(props, line)
}
