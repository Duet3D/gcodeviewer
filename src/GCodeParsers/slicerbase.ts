export default abstract class SlicerBase {
   feature = ''
   currentFeatureColor = [1, 1, 1, 1]
   currentIsPerimeter = true
   currentIsSupport = false
   missingFeatures = []

   constructor() {}

   processComment(comment: string) {}

   isPerimeter(): boolean {
      return this.currentIsPerimeter
   }

   isSupport(): boolean {
      return this.currentIsSupport
   }

   getFeatureColor() {
      return this.currentFeatureColor
   }

   reportMissingFeature(featureName) {
      if (!this.missingFeatures.includes(featureName)) {
         console.error(`Missing feature ${featureName}`)
         this.missingFeatures.push(featureName)
      }
   }
}
