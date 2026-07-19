import { Base, Move, ArcMove } from '.'
import ProcessorProperties from '../processorproperties'

// Replaces a fully parsed Move/ArcMove once its geometry lives in the mesh buffers, keeping only
// what picking and the G-code list still need
export default class extends Base {
   color: number[] = [1, 1, 1, 1]

   constructor(props: ProcessorProperties, move: Move | ArcMove) {
      super(props, '')
      this.lineType = move.lineType
      this.filePosition = move.filePosition
      this.lineNumber = move.lineNumber
      this.lineLength = move.lineLength
      this.color = move.color
   }
}
