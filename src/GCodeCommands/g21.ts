import { Base, Command } from '../GCodeLines'
import Props, { Units } from '../processorproperties'

export default function (props: Props, line: string): Base {
   props.units = Units.millimeters
   return new Command(props, line)
}
