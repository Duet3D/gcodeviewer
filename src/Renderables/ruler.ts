import { Scene } from '@babylonjs/core/scene'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { makeTextPlane } from './textplane'
import { BuildVolume } from './bed'

// Numeric tick labels along the front (G-code X) and left (G-code Y) bed edges, giving the grid a
// scale reference. Laid flat on the bed plane rather than billboarded, so they stay readable from
// the top-down and oblique views this viewer is normally used from
export default class Ruler {
   private scene: Scene
   private labels: Mesh[] = []
   private volume: BuildVolume | null = null
   visible = true
   color = '#FFFFFF'
   interval: number | null = null
   // Spacing the last build() actually used, so the bed grid can line its major lines up with it
   tickInterval = 0
   registerClipIgnore: (mesh: Mesh) => void = () => {}

   constructor(scene: Scene) {
      this.scene = scene
   }

   // A 1/2/5 x 10^n interval targeting 4-6 ticks across the larger axis. Fewer, larger labels read
   // better at the zoom level a whole bed is viewed at than the density a graph axis would use
   private static niceInterval(span: number): number {
      if (!Number.isFinite(span) || span <= 0) {
         return 10
      }
      const roughStep = span / 5
      const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
      const residual = roughStep / magnitude
      const niceResidual = residual < 1.5 ? 1 : residual < 3.5 ? 2 : residual < 7.5 ? 5 : 10
      return niceResidual * magnitude
   }

   private formatTick(value: number): string {
      const rounded = Math.round(value * 100) / 100
      return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2)
   }

   private addLabel(text: string, gcodeX: number, gcodeY: number, size: number): void {
      const plane = makeTextPlane(this.scene, text, this.color, 'transparent', size, size * 0.6)
      plane.rotationQuaternion = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2)
      plane.position = new Vector3(gcodeX, 0.1, gcodeY)
      plane.isPickable = false
      plane.setEnabled(this.visible)
      this.registerClipIgnore(plane)
      this.labels.push(plane)
   }

   build(volume: BuildVolume): void {
      this.dispose()
      this.volume = volume

      const sizeX = volume.x.max - volume.x.min
      const sizeY = volume.y.max - volume.y.min
      const requested = this.interval !== null && this.interval > 0 ? this.interval : Ruler.niceInterval(Math.max(sizeX, sizeY))
      if (!Number.isFinite(requested) || requested <= 0) {
         return
      }
      // Every label carries its own DynamicTexture, so a very small interval on a large bed is
      // expensive enough to matter. Widen it to whole multiples until the count is sane
      const maxTicks = 40
      const interval = requested * Math.max(Math.ceil(Math.max(sizeX, sizeY) / requested / maxTicks), 1)
      this.tickInterval = interval

      // Sized off the bed span rather than the tick interval, so labels stay legible whatever the
      // resulting tick density is
      const labelSize = Math.min(Math.max(Math.max(sizeX, sizeY) * 0.08, 6), 28)
      const margin = labelSize * 0.9

      const firstX = Math.ceil(volume.x.min / interval) * interval
      for (let x = firstX; x <= volume.x.max + 1e-6; x += interval) {
         this.addLabel(this.formatTick(x), x, volume.y.min - margin, labelSize)
      }

      const firstY = Math.ceil(volume.y.min / interval) * interval
      for (let y = firstY; y <= volume.y.max + 1e-6; y += interval) {
         // The X loop already labelled the origin corner
         if (Math.abs(y - volume.y.min) < 1e-6) {
            continue
         }
         this.addLabel(this.formatTick(y), volume.x.min - margin, y, labelSize)
      }
   }

   show(visible: boolean): void {
      this.visible = visible
      this.labels.forEach((label) => label.setEnabled(visible))
   }

   setInterval(interval: number | null): void {
      this.interval = interval
      if (this.volume) {
         this.build(this.volume)
      }
   }

   dispose(): void {
      this.labels.forEach((label) => label.dispose())
      this.labels = []
   }
}
