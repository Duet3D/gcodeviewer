import { Base, Comment } from '../GCodeLines'
import Props from '../processorproperties'

const toolRegex = /^[T]-?[0-9]+/g

export default function (props: Props, line: string): Base {
   let toolIdx = Number(line.match(toolRegex)[0].substring(1).trim())
   if (toolIdx == -1) {
      toolIdx = 0
   }
   props.currentTool = props.tools[toolIdx]
   return new Comment(props, line)
}
