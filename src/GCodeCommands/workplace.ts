//This deals with G54-G59.3

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Base, Command } from '../GCodeLines'
import Props from '../processorproperties'

export default function (props: Props, line: string): Base {
   const match = line.match(/G5(\d(?:\.[1-3])?)/i)
   if (match) {
      // G54..G59 map to workplace 0..5, G59.1..G59.3 continue as 6..8
      const parts = match[1].split('.')
      const major = Number(parts[0])
      const minor = parts.length > 1 ? Number(parts[1]) : 0
      if (major >= 4 && major <= 9 && (minor === 0 || major === 9)) {
         const idx = major - 4 + minor
         // Absolute moves read currentWorkplace, so the offsets array must cover the new index
         while (props.workplaceOffsets.length <= idx) {
            props.workplaceOffsets.push(new Vector3(0, 0, 0))
         }
         props.currentWorkplaceIdx = idx
      }
   }

   return new Command(props, line)
}
