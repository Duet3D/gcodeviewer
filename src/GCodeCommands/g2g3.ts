import { ArcMove, Base, Move } from '../GCodeLines'
import Props from '../processorproperties'
import { doArc } from '../util'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

const tokenList = /(?=[GXYZIJKFRE])/

//Reminder Add G53 check

export default function (props: Props, line: string): Base {
   const move = new ArcMove(props, line)

   const tokens = line.split(tokenList)

   move.extruding = tokens.some((t) => t[0].toUpperCase() === 'E' && Number(t.substring(1)) > 0) || props.cncMode

   // F is modal for the whole line; doArc does not parse it
   for (const token of tokens) {
      if (token[0].toUpperCase() === 'F') {
         props.CurrentFeedRate = Number(token.substring(1)) * props.unitMultiplier
      }
   }
   move.feedRate = props.CurrentFeedRate
   if (move.extruding) {
      props.recordExtrusionFeedRate(move.feedRate)
   }

   let arcResult = {
      position: { x: props.currentPosition.x, y: props.currentPosition.y, z: props.currentPosition.z },
      points: [],
   }

   try {
      arcResult = doArc(
         tokens,
         props.currentPosition,
         !props.absolute,
         0.5,
         props.fixRadius,
         props.arcPlane,
         props.currentWorkplace,
         props.unitMultiplier,
      )
   } catch (ex) {
      console.error(`Arc Error`, ex)
   }
   let curPt = []
   props.currentPosition.toArray(curPt)

   arcResult.points.forEach((point, idx) => {
      const segment = new Move(props, line)
      segment.tool = props.currentTool.toolNumber
      segment.lineNumber = move.lineNumber
      segment.filePosition = move.filePosition
      segment.feedRate = props.CurrentFeedRate
      segment.color = props.slicer.getFeatureColor()
      segment.isPerimeter = props.slicer.isPerimeter()
      segment.isSupport = props.slicer.isSupport()

      segment.start = [curPt[0], curPt[1], curPt[2]]
      segment.end = [point.x, point.y, point.z]
      segment.extruding = move.extruding
      curPt = segment.end
      move.segments.push(segment)
   })

   // The arc's end position even when tessellation aborted (radius errors still move the machine).
   // Segment Moves already incremented totalRenderedSegments in their constructor
   props.currentPosition = new Vector3(arcResult.position.x, arcResult.position.y, arcResult.position.z)

   return move
}
