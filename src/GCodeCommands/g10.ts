import { Vector3 } from '@babylonjs/core/Maths/math.vector'

import { Base, Command } from '../GCodeLines'
import Props from '../processorproperties'

// A bare G10 is firmware retraction. G10 L2 sets a workplace origin to the given machine
// coordinates, G10 L20 sets it so that the current position reads as the given values. Any other
// parameterised form sets tool offsets or standby temperatures - state this viewer does not track,
// but it must never count as a retract or, worse, as a move
export default function (props: Props, line: string): Base {
   const command = new Command(props, line)
   if (/^G10\s*(;.*)?$/i.test(line.trim())) {
      props.firmwareRetraction = true
      return command
   }

   let mode = 0
   let workplace = -1
   const axes: Record<string, number> = {}
   for (const token of line.split(/\s+/)) {
      const key = token.substring(0, 1).toUpperCase()
      const value = Number(token.substring(1))
      if (isNaN(value)) {
         continue
      }
      if (key === 'L') {
         mode = value
      } else if (key === 'P') {
         workplace = value
      } else if (key === 'X' || key === 'Y' || key === 'Z') {
         axes[key] = value * props.unitMultiplier
      }
   }

   if (mode !== 2 && mode !== 20) {
      return command
   }

   // P is 1-based (P1 = G54); P0 and a missing P both mean the active workplace
   const index = workplace > 0 ? workplace - 1 : props.currentWorkplaceIdx
   if (index < 0 || index > 8) {
      return command
   }
   // The offset table grows on demand, so a file may set an offset before ever selecting that
   // workplace with G54-G59
   while (props.workplaceOffsets.length <= index) {
      props.workplaceOffsets.push(new Vector3(0, 0, 0))
   }
   const offset = props.workplaceOffsets[index]

   // currentPosition already has the active offset applied, so it is in machine coordinates, and it
   // is stored Babylon-style: G-code Y lives in z, G-code Z in y. Axes the command leaves out keep
   // their current offset
   if (axes.X !== undefined) {
      offset.x = mode === 2 ? axes.X : props.currentPosition.x - axes.X
   }
   if (axes.Y !== undefined) {
      offset.y = mode === 2 ? axes.Y : props.currentPosition.z - axes.Y
   }
   if (axes.Z !== undefined) {
      offset.z = mode === 2 ? axes.Z : props.currentPosition.y - axes.Z
   }
   return command
}
