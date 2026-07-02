import ProcessorProperties from '../processorproperties'
import SlicerBase from './slicerbase'

export default class KiriMoto extends SlicerBase {
   featureList = {
      SHELLS: { color: [1, 0.9, 0.3, 1], perimeter: true, support: false },
      'SPARSE INFILL': { color: [0.59, 0.19, 0.16, 1], perimeter: false, support: false },
      'SOLID FILL': { color: [0.59, 0.19, 0.8, 1], perimeter: true, support: false },
      UNKNOWN: { color: [0.5, 0.5, 0.5, 1], perimeter: false, support: false },

      //Look up colors
      'SUPPORT MATERIAL': { color: [0.5, 0.5, 0.5, 1], perimeter: false, support: true },
      'SUPPORT MATERIAL INTERFACE': { color: [0.5, 0.5, 0.5, 1], perimeter: false, support: true },
      'OVERHANG PERIMETER': { color: [0.5, 0.5, 0.5, 1], perimeter: true, support: false },
      'WIPE TOWER': { color: [0.5, 0.5, 0.5, 1], perimeter: true, support: false },
   }

   constructor() {
      super()
      console.info('KiriMoto detected')
   }

   processComment(comment: string) {
      if (comment.startsWith(';TYPE:')) {
         this.feature = comment.substring(6).trim()
         const feature = this.featureList[this.feature]
         if (feature) {
            this.currentFeatureColor = feature.color
            this.currentIsPerimeter = feature.perimeter
            this.currentIsSupport = feature.support
         } else {
            this.reportMissingFeature(this.feature)
            this.currentFeatureColor = [1, 1, 1, 1]
            this.currentIsPerimeter = true
            this.currentIsSupport = false
         }
      }
   }

   getFeatureColor(): number[] {
      return this.currentFeatureColor
   }

   isPerimeter(): boolean {
      return this.currentIsPerimeter
   }

   isSupport(): boolean {
      return this.currentIsSupport
   }

   processHeader(file: string[], props: ProcessorProperties) {}
}
