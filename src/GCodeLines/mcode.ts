import ProcessorProperties from '../processorproperties'
import Base from './base'

export default class MCode extends Base {
   lineType = 'M'
   constructor(props: ProcessorProperties, line: string) {
      super(props, line)
   }
}
