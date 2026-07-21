import Base from './base'
import ProcessorProperties from '../processorproperties'
//This is used for non-move gcodes
export default class Command extends Base {
   lineType = 'G'
   constructor(props: ProcessorProperties, line: string) {
      super(props, line)
   }
}
