import { ArcMove, Base, Move } from '../GCodeLines'
import Props from '../processorproperties'
import { doArc } from '../util'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

const tokenList = /(?=[GXYZIJKFRE])/

//Reminder Add G53 check

export default function (props: Props, line: string): Base {
   const move = new ArcMove(props, line)

   move.feedRate = props.CurrentFeedRate

   const tokens = line.split(tokenList)

   move.extruding = line.indexOf('E') > 0 || props.cncMode //|| this.g1AsExtrusion //Treat as an extrusion in cnc mode

   // let cw = tokens.filter((t) => t === 'G2' || t === 'G02')

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
      )
   } catch (ex) {
      console.error(`Arc Error`, ex)
   }
   let curPt = []
   props.currentPosition.toArray(curPt)

   arcResult.points.forEach((point, idx) => {
      const line = new Move(props, move.line)
      line.tool = props.currentTool.toolNumber
      line.lineNumber = move.lineNumber
      line.filePosition = move.filePosition
      line.feedRate = props.CurrentFeedRate
      line.color = props.slicer.getFeatureColor()
      line.isPerimeter = props.slicer.isPerimeter()
      line.isSupport = props.slicer.isSupport()

      line.start = [curPt[0], curPt[1], curPt[2]]
      line.end = [point.x, point.y, point.z]
      line.extruding = move.extruding
      curPt = line.end
      move.segments.push(line)
   })

   //Last point to currentposition
   props.currentPosition = Vector3.FromArray(curPt)
   props.totalRenderedSegments += move.segments.length

   return move
}
