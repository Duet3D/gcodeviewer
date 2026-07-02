import { Scene } from '@babylonjs/core/scene'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { makeTextPlane } from './textplane'

export default class Axes {
   visible = true
   size = 50
   debug = false
   registerClipIgnore: (mesh: Mesh) => void = () => {}

   private scene: Scene
   private axesMesh: Mesh = null

   constructor(scene: Scene) {
      this.scene = scene
   }

   show(visible: boolean): void {
      this.visible = visible
      if (this.axesMesh) {
         this.axesMesh.setEnabled(visible)
      }
      this.scene.render()
   }

   resize(size: number): void {
      this.size = size
      if (this.axesMesh) {
         this.axesMesh.dispose(false, true)
      }
      this.render()
   }

   render(position?: Vector3): void {
      if (this.debug) {
         return
      }
      if (this.axesMesh && !this.axesMesh.isDisposed()) {
         if (position) {
            this.axesMesh.position = position
         }
         return
      }

      this.axesMesh = new Mesh('axis', this.scene)
      this.registerClipIgnore(this.axesMesh)

      // G-code Y runs along Babylon Z and vice versa, hence the swapped mesh names below
      const axisX = MeshBuilder.CreateLines('axisX', {
         points: [
            Vector3.Zero(),
            new Vector3(this.size, 0, 0),
            new Vector3(this.size * 0.95, 0.05 * this.size, 0),
            new Vector3(this.size, 0, 0),
            new Vector3(this.size * 0.95, -0.05 * this.size, 0)
         ]
      }, this.scene)
      axisX.color = new Color3(1, 0, 0)
      axisX.parent = this.axesMesh
      const xChar = makeTextPlane(this.scene, 'X', 'red', 'transparent', this.size / 10, this.size / 10)
      xChar.position = new Vector3(0.9 * this.size, 0.05 * this.size, 0)
      xChar.parent = this.axesMesh

      const axisY = MeshBuilder.CreateLines('axisZ', {
         points: [
            Vector3.Zero(),
            new Vector3(0, 0, this.size),
            new Vector3(0, -0.05 * this.size, this.size * 0.95),
            new Vector3(0, 0, this.size),
            new Vector3(0, 0.05 * this.size, this.size * 0.95)
         ]
      }, this.scene)
      axisY.color = new Color3(0, 1, 0)
      axisY.parent = this.axesMesh
      const yChar = makeTextPlane(this.scene, 'Y', 'green', 'transparent', this.size / 10, this.size / 10)
      yChar.position = new Vector3(0, 0.05 * this.size, 0.9 * this.size)
      yChar.parent = this.axesMesh

      const axisZ = MeshBuilder.CreateLines('axisY', {
         points: [
            Vector3.Zero(),
            new Vector3(0, this.size, 0),
            new Vector3(-0.05 * this.size, this.size * 0.95, 0),
            new Vector3(0, this.size, 0),
            new Vector3(0.05 * this.size, this.size * 0.95, 0)
         ]
      }, this.scene)
      axisZ.color = new Color3(0, 0, 1)
      axisZ.parent = this.axesMesh
      const zChar = makeTextPlane(this.scene, 'Z', 'blue', 'transparent', this.size / 10, this.size / 10)
      zChar.position = new Vector3(0, 0.9 * this.size, -0.05 * this.size)
      zChar.parent = this.axesMesh

      this.axesMesh.setEnabled(this.visible)
      this.axesMesh.getChildren().forEach((mesh) => this.registerClipIgnore(mesh as Mesh))
      if (position) {
         this.axesMesh.position = position
      }
   }

   dispose(): void {
      if (this.axesMesh) {
         this.axesMesh.dispose(false, true)
         this.axesMesh = null
      }
   }
}
