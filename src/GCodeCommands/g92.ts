import { Base, Command } from '../GCodeLines'
import Props from '../processorproperties'

// G92 redefines the current logical position. Only X/Y/Z matter for rendering; E resets are ignored
// because extrusion detection works on per-line E values, not accumulated filament length
export default function (props: Props, line: string): Base {
   const command = new Command(props, line)
   const unit = props.unitMultiplier
   const x = line.match(/X(-?[0-9.]+)/i)
   const y = line.match(/Y(-?[0-9.]+)/i)
   const z = line.match(/Z(-?[0-9.]+)/i)
   if (x) {
      props.currentPosition.x = Number(x[1]) * unit + props.currentWorkplace.x
   }
   if (y) {
      props.currentPosition.z = Number(y[1]) * unit + props.currentWorkplace.y
   }
   if (z) {
      props.currentPosition.y = Number(z[1]) * unit + props.currentWorkplace.z
   }
   return command
}
