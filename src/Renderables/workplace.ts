import { Scene } from '@babylonjs/core/scene'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { makeTextPlane } from './textplane'

// Origin marker for every workplace a file actually shifts into (G54-G59, set via G10 L2/L20).
// The active-at-start workplace sits at the machine origin where the axes indicator already is, so
// only offset ones are drawn - anything else would just z-fight with the axes
export default class Workplace {
   visible = false
   size = 20
   registerClipIgnore: (mesh: Mesh) => void = () => {}

   private scene: Scene
   private markers: Mesh[] = []
   private offsets: Vector3[] = []

   constructor(scene: Scene) {
      this.scene = scene
   }

   show(visible: boolean): void {
      this.visible = visible
      this.markers.forEach((marker) => marker.setEnabled(visible))
      this.scene.render()
   }

   // Offsets are in G-code axis order (x, y, z) and get swapped into Babylon space here
   render(offsets: Vector3[]): void {
      this.offsets = offsets
      this.dispose()

      offsets.forEach((offset, index) => {
         if (offset.x === 0 && offset.y === 0 && offset.z === 0) {
            return
         }

         const marker = new Mesh(`workplace${index}`, this.scene)
         this.registerClipIgnore(marker)

         const cross = MeshBuilder.CreateLines(`workplaceCross${index}`, {
            points: [
               new Vector3(-this.size / 2, 0, 0),
               new Vector3(this.size / 2, 0, 0),
               new Vector3(0, 0, 0),
               new Vector3(0, 0, -this.size / 2),
               new Vector3(0, 0, this.size / 2),
               new Vector3(0, 0, 0),
               new Vector3(0, this.size / 2, 0)
            ]
         }, this.scene)
         cross.color = new Color3(1, 0.6, 0)
         cross.parent = marker

         const label = makeTextPlane(this.scene, `G${54 + index}`, 'orange', 'transparent', this.size / 2, this.size / 2)
         label.position = new Vector3(0, this.size / 2, 0)
         label.parent = marker

         marker.position = new Vector3(offset.x, offset.z, offset.y)
         marker.setEnabled(this.visible)
         marker.getChildren().forEach((child) => this.registerClipIgnore(child as Mesh))
         this.markers.push(marker)
      })
   }

   // Re-renders from the offsets of the last render, e.g. after the size changed
   refresh(): void {
      this.render(this.offsets)
   }

   dispose(): void {
      this.markers.forEach((marker) => marker.dispose(false, true))
      this.markers = []
   }
}
