import ProcessorProperties from '../processorproperties'

/*
C = Comment
A = Arc Move
L = Linear Move
T = Travel
M = MCode Command
G = GCode Command

*/

export default abstract class Base {
   // The raw text is deliberately NOT stored per line: V8 substrings are sliced strings that pin the
   // whole source file anyway, so per-line strings would cost millions of string objects without
   // saving the file copy. Processor.lineText() re-slices on demand from the retained original file
   lineLength: number = 0
   lineNumber: number = 0
   filePosition: number = 0
   lineType: string = 'C'

   constructor(props: ProcessorProperties, line: string) {
      this.lineLength = line.length
      this.lineNumber = props.lineNumber
      this.filePosition = props.filePosition
   }
}
