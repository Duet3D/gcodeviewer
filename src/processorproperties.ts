import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import Tool, { tools } from './tools'
import { Color4 } from '@babylonjs/core/Maths/math.color'
import SlicerBase from './GCodeParsers/slicerbase'
import GenericBase from './GCodeParsers/genericbase'

// Fallback extrusion height until two extruding layers have been seen
export const DEFAULT_LAYER_HEIGHT = 0.2

export enum ColorMode {
   Tool,
   Feature,
   FeedRate,
}

export enum ArcPlane {
   XY = 'XY',
   XZ = 'XZ',
   YZ = 'YZ',
}

export enum Units {
   millimeters = 'mm',
   inches = 'in',
}

//This is the class that holds all the properties that are used by the processor
export default class ProcessorProperties {
   maxHeight: number = 0
   minHeight: number = 0
   lineCount: number = 0
   layerDictionary: [] = []
   previousZ: number = 0 //Last Z value where extrusion occured  - This may need to go away to depend on slicer especially for non-planar prints
   currentLayerHeight: number = DEFAULT_LAYER_HEIGHT
   filePosition: number = 0
   lineNumber: number = 0
   tools: Tool[] = []
   currentTool: Tool
   currentPosition: Vector3 = new Vector3(0, 0, 0)
   currentFeedRate: number = 1
   maxFeedRate: number = 1
   minFeedRate: number = 999999999
   progressColor: Color4 = new Color4(0, 1, 0, 1)
   progressAnimation: boolean = true //Formerly known as "renderAnimation"
   firstGCodeByte: number = 0
   lastGCodeByte: number = 0
   hasMixing: boolean = false
   currentWorkplaceIdx: number = 0
   workplaceOffsets: Vector3[] = []
   // G-code defaults to absolute positioning; files may still switch with G90/G91
   absolute: boolean = true
   firmwareRetraction: boolean = false
   units = Units.millimeters
   totalRenderedSegments: number = 0
   fixRadius: boolean = false // Used to fix a radius on an arc if it's too small. Some CNC processors "fix" G2/G3 for you
   arcPlane: ArcPlane = ArcPlane.XY // Used to determine the plane of an arc
   cncMode: boolean = false
   spindleSpeed: number = 0
   spindleOn: boolean = false
   bedLevelingActive: boolean = false
   extruderAbsolute: boolean = true
   slicer: SlicerBase = new GenericBase()

   //Used for belt processing
   zBelt: boolean = false
   zBeltLength: number = 100
   gantryAngle = (45 * Math.PI) / 180
   currentZ = 0
   hyp = Math.cos(this.gantryAngle)
   adj = Math.tan(this.gantryAngle)

   setGantryAngle(angle: number) {
      this.gantryAngle = (angle * Math.PI) / 180
      this.hyp = Math.cos(this.gantryAngle)
      this.adj = Math.tan(this.gantryAngle)
   }

   get CurrentFeedRate(): number {
      return this.currentFeedRate
   }

   set CurrentFeedRate(value: number) {
      this.currentFeedRate = value
   }

   // Min/max only cover feed rates actually used while extruding - travel rates would compress the
   // feed-rate color gradient into a fraction of its range
   // Layer height is the Z delta between consecutive extruding layers. Non-planar prints and Z
   // hops would otherwise produce nonsense, so implausible deltas keep the previous value
   recordLayerHeight(z: number) {
      const delta = Math.abs(z - this.previousZ)
      if (delta > 0.001) {
         if (delta < 5) {
            this.currentLayerHeight = delta
         }
         this.previousZ = z
      }
   }

   recordExtrusionFeedRate(value: number) {
      if (value > this.maxFeedRate) {
         this.maxFeedRate = value
      }
      if (value > 0 && value < this.minFeedRate) {
         this.minFeedRate = value
      }
   }

   get unitMultiplier(): number {
      return this.units === Units.inches ? 25.4 : 1
   }

   get currentWorkplace() {
      return this.workplaceOffsets[this.currentWorkplaceIdx]
   }

   buildToolFloat32Array() {
      const toolArray = new Array(this.tools.length * 4)
      for (let idx = 0; idx < this.tools.length; idx++) {
         this.tools[idx].color.toArray(toolArray, idx * 4)
      }
      return toolArray
   }

   constructor() {
      this.workplaceOffsets.push(new Vector3(0, 0, 0)) //set a default workplace if we do not have workplaces
      // Copy the default tool table - t.ts may extend it per file, which must not leak into the
      // shared module-level array
      this.tools = [...tools]
      this.currentTool = this.tools[0]
   }
}
