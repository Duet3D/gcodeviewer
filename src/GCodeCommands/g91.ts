import { Base, Command } from '../GCodeLines'
import Props from '../processorproperties'

export default function (props: Props, line: string): Base {
   const command = new Command(props, line)
   props.absolute = false
   return command
}
