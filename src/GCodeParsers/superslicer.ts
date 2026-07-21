import SlicerBase from './slicerbase'

export default class SuperSlicer extends SlicerBase {
   featureList = {
      PERIMETER: { color: [1, 0.9, 0.3, 1], perimeter: false, support: false },
      'EXTERNAL PERIMETER': { color: [1, 0.5, 0.2, 1], perimeter: true, support: false },
      'INTERNAL INFILL': { color: [0.59, 0.19, 0.16, 1], perimeter: false, support: false },
      'SOLID INFILL': { color: [0.59, 0.19, 0.8, 1], perimeter: false, support: false },
      'TOP SOLID INFILL': { color: [0.95, 0.25, 0.25, 1], perimeter: true, support: false },
      'BRIDGE INFILL': { color: [0.3, 0.5, 0.73, 1], perimeter: false, support: false },
      'GAP FILL': { color: [1, 1, 1, 1], perimeter: false, support: false },
      SKIRT: { color: [0, 0.53, 0.43, 1], perimeter: false, support: false },
      'SKIRT/BRIM': { color: [0, 0.53, 0.43, 1], perimeter: false, support: false },
      'SUPPORTED MATERIAL': { color: [0, 1, 0, 1], perimeter: false, support: true },
      'SUPPORTED MATERIAL INTERFACE': { color: [0, 0.5, 0, 1], perimeter: false, support: true },
      CUSTOM: { color: [0.5, 0.5, 0.5, 1], perimeter: false, support: false },
      UNKNOWN: { color: [0.5, 0.5, 0.5, 1], perimeter: false, support: false },

      //Look up colors
      'SUPPORT MATERIAL': { color: [0.5, 0.5, 0.5, 1], perimeter: false, support: false },
      'SUPPORT MATERIAL INTERFACE': { color: [0.5, 0.5, 0.5, 1], perimeter: false, support: false },
      'OVERHANG PERIMETER': { color: [0.5, 0.5, 0.5, 1], perimeter: true, support: false },
      'WIPE TOWER': { color: [0.5, 0.5, 0.5, 1], perimeter: false, support: false },
   }

   constructor() {
      super()
      console.info('SuperSlicer detected')
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

}
