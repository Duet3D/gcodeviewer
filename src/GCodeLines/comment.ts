import Base from './base'
import ProcessorProperties from '../processorproperties'

export default class Comment extends Base {
   lineType = 'C'
   comment: string = ''
   constructor(props: ProcessorProperties, line: string) {
      super(props, line)
      if (line.startsWith('M')) {
         this.lineType = 'M'
      }
      props.slicer.processComment(line)
   }
}
