import { Color4 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import Base from './base'
import { numToColor } from '../util'
import ProcessorProperties from '../processorproperties'

const PIOVER2 = Math.PI / 2
const VECDIV2 = [2, 2, 2]

export class PointData {
   Matrix: Matrix
   Color: Color4
   Props: any
}

export class MoveData {
   Matrix: Matrix
   Color: number[]
   Props: any
}

//Use tool 255 for travels

export default class Move extends Base {
   lineType = 'L'
   tool: number = 0
   start: number[] = [0, 0, 0]
   end: number[] = [0, 0, 0]
   extruding: boolean = false
   color: number[] = [1, 1, 1, 1]
   feedRate: number = 0
   layerHeight: number = 0.2
   isPerimeter: boolean = false
   isSupport: boolean = false
   colorId: number[] = [0, 0, 0] //Important note - ColorID is 1 indexed to match the file position.

   constructor(props: ProcessorProperties, line: string) {
      super(props, line)
      props.totalRenderedSegments += 1 //We need to track segment counts because of arcs
      this.color = props.slicer.getFeatureColor()
      this.isPerimeter = props.slicer.isPerimeter()
      this.isSupport = props.slicer.isSupport()
   }

   get length(): number {
      return Vector3.Distance(
         new Vector3(this.start[0], this.start[1], this.start[2]),
         new Vector3(this.end[0], this.end[1], this.end[2]),
      )
   }

   static add(a: number[], b: number[]): number[] {
      return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
   }

   static subtract(a: number[], b: number[]): number[] {
      return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
   }

   static divide(a: number[], b: number[]): number[] {
      return [a[0] / b[0], a[1] / b[1], a[2] / b[2]]
   }

   //Padding is also doing a conversion from meters to mm -- Need to change how this is working
   renderLine(nozzleSize = 0.4, padding = 0, layerHeight?: number): MoveData {
      this.colorId = numToColor(this.lineNumber)
      const p: MoveData = new MoveData()
      const length = this.length + padding * 0.1
      const midPoint = Move.divide(Move.add(this.start, this.end), VECDIV2) //this.start.add(this.end).divide(VECDIV2)
      const v = Move.subtract(this.end, this.start) // this.end.subtract(this.start)
      const r = Math.sqrt(Math.pow(v[0], 2) + Math.pow(v[1], 2) + Math.pow(v[2], 2))
      const phi = Math.atan2(v[2], v[0])
      const theta = Math.acos(v[1] / r)
      p.Matrix = Matrix.Compose(
         new Vector3(length, layerHeight ?? this.layerHeight, nozzleSize),
         Quaternion.FromEulerVector(new Vector3(0, -phi, PIOVER2 - theta)),
         new Vector3(midPoint[0], midPoint[1], midPoint[2]),
      )
      p.Color = this.color
      p.Props = {
         lineNumber: this.lineNumber,
         filePosition: this.filePosition,
         originalColor: this.color,
      }

      return p
   }
}
