import { Base, Move } from './'
import ProcessorProperties from '../processorproperties'
import { numToColor } from '../util'

export default class ArcMove extends Base {
   lineType = 'A'
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
   segments: Move[] = []

   constructor(props: ProcessorProperties, line: string) {
      super(props, line)
      this.color = props.slicer.getFeatureColor()
      this.colorId = numToColor(this.lineNumber)
      this.isPerimeter = props.slicer.isPerimeter()
      this.isSupport = props.slicer.isSupport()
   }
}
