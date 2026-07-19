import { Base, Command } from '../GCodeLines'
import Props from '../processorproperties'

// A bare G10 is firmware retraction. With parameters (P/L/R/S/X/Y/Z) it sets tool or workplace
// offsets and standby temperatures instead - state this viewer does not track, but it must never
// count as a retract or, worse, as a move
export default function (props: Props, line: string): Base {
   const command = new Command(props, line)
   if (/^G10\s*(;.*)?$/i.test(line.trim())) {
      props.firmwareRetraction = true
   }
   return command
}
