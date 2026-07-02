import ProcessorProperties from '../processorproperties'
import SlicerBase from './slicerbase'

export default class OrcaSlicer extends SlicerBase {
   featureList = {
      'OUTER WALL': {
         color: [1, 0.9, 0.3, 1],
         perimeter: true,
         support: false,
      },
      'INNER WALL': {
         color: [1, 0.49, 0.22, 1],
         perimeter: false,
         support: false,
      },
      'OVERHANG WALL': {
         color: [0.15, 0.16, 0.75, 1],
         perimeter: false,
         support: false,
      },
      'SPARSE INFILL': {
         color: [0.69, 0.19, 0.16, 1],
         perimeter: false,
         support: false,
      },
      'INTERNAL SOLID INFILL': {
         color: [0.59, 0.33, 0.8, 1],
         perimeter: false,
         support: false,
      },
      'TOP SURFACE': {
         color: [0.7, 0.22, 0.22, 1],
         perimeter: true,
         support: false,
      },

      'BOTTOM SURFACE': {
         color: [0.4, 0.36, 0.78, 1],
         perimeter: true,
         support: false,
      },

      BRIDGE: {
         color: [0.3, 0.5, 0.73, 1],
         perimeter: false,
         support: false,
      },
      CUSTOM: {
         color: [0.37, 0.82, 0.58, 1],
         perimeter: false,
         support: false,
      },
      SUPPORT: {
         color: [0, 1, 0, 1],
         perimeter: false,
         support: true,
      },
      'SUPPORT INTERFACE': {
         color: [0.12, 0.38, 0.13, 1],
         perimeter: false,
         support: true,
      },
      'PRIME TOWER': {
         color: [0.7, 0.89, 0.67, 1],
         perimeter: false,
         support: false,
      },
   }

   constructor() {
      super()
      console.info('OrcaSlicer detected')
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
