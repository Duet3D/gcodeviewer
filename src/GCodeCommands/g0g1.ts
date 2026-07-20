import { Move, Base } from '../GCodeLines'
import Props from '../processorproperties'

//Reminder Add G53 check

const tokenList = /(?=[GXYZEFUVAB])/

export default function (props: Props, line: string): Base {
   const move = new Move(props, line)
   move.tool = props.currentTool.toolNumber
   props.currentPosition.toArray(move.start)

   const tokens = line.split(tokenList)

   let forceAbsolute = false
   const unit = props.unitMultiplier

   if (props.zBelt) tokens.reverse()

   for (let idx = 0; idx < tokens.length; idx++) {
      const token = tokens[idx]
      const firstChar = token[0].toUpperCase()
      switch (firstChar) {
         case 'G': {
            const upperToken = token.toUpperCase()
            if (upperToken == 'G53') forceAbsolute = true
            if (upperToken == 'G1' || upperToken == 'G01') {
               //move.extruding = true
               props.currentTool.color.toArray(move.color)
               move.extruding = props.cncMode
            }
            break
         }
         case 'X':
            if (props.zBelt) {
               props.currentPosition.x = Number(token.substring(1)) * unit
            } else {
               props.currentPosition.x =
                  props.absolute || forceAbsolute
                     ? Number(token.substring(1)) * unit + props.currentWorkplace.x
                     : props.currentPosition.x + Number(token.substring(1)) * unit
            }
            break
         case 'Y':
            if (props.zBelt) {
               props.currentPosition.y = Number(token.substring(1)) * unit * props.hyp
               props.currentPosition.z = props.currentZ + props.currentPosition.y * props.adj
            } else {
               props.currentPosition.z =
                  props.absolute || forceAbsolute
                     ? Number(token.substring(1)) * unit + props.currentWorkplace.y
                     : props.currentPosition.z + Number(token.substring(1)) * unit
            }
            break
         case 'Z':
            if (props.zBelt) {
               props.currentZ = -Number(token.substring(1)) * unit
               props.currentPosition.z = props.currentZ + props.currentPosition.y * props.adj
            } else {
               props.currentPosition.y =
                  props.absolute || forceAbsolute
                     ? Number(token.substring(1)) * unit + props.currentWorkplace.z
                     : props.currentPosition.y + Number(token.substring(1)) * unit
            }
            break
         case 'E':
            if (Number(token.substring(1)) > 0) {
               move.extruding = true
            }
            break
         case 'F':
            // F is modal for the whole line regardless of token order and extrusion state
            props.CurrentFeedRate = Number(token.substring(1)) * unit
            break
      }
   }

   if (!move.extruding) {
      move.lineType = 'T'
      move.tool = 255
   }

   move.feedRate = props.CurrentFeedRate
   if (move.extruding) {
      props.recordExtrusionFeedRate(move.feedRate)
      props.recordLayerHeight(props.currentPosition.y)
      move.layerHeight = props.currentLayerHeight
   }
   props.currentPosition.toArray(move.end)

   return move
}
