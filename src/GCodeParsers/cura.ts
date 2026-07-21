import SlicerBase from './slicerbase'

export default class Cura extends SlicerBase {
   featureList = {
      SKIN: { color: [1, 0.9, 0.3, 1], perimeter: true, support: false },
      'WALL-OUTER': { color: [1, 0.5, 0.2, 1], perimeter: true, support: false },
      'WALL-INNER': { color: [0.59, 0.19, 0.16, 1], perimeter: false, support: false },
      FILL: { color: [0.95, 0.25, 0.25, 1], perimeter: false, support: false },
      SKIRT: { color: [0, 0.53, 0.43, 1], perimeter: false, support: false },
      SUPPORT: { color: [0, 0.53, 0.43, 1], perimeter: false, support: true },
      CUSTOM: { color: [0.5, 0.5, 0.5, 1], perimeter: false, support: false },
      UNKNOWN: { color: [0.5, 0.5, 0.5, 1], perimeter: false, support: false },
   }

   constructor() {
      super()
      console.info('Cura detected')
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
