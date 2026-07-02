import { Scene } from '@babylonjs/core/scene'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'

// Text label rendered onto a plane via DynamicTexture. Runs inside the render worker, so no DOM/SVG APIs may be used here
export function makeTextPlane(scene: Scene, text: string, textColor: string, backgroundColor: string, width: number, height: number, fontSize: number = 75): Mesh {
   const texture = new DynamicTexture(`textplane-texture-${text}`, { width: 400, height: 300 }, scene, true)
   texture.drawText(text, null, null, `bold ${fontSize}px sans-serif`, textColor, backgroundColor, true)

   const material = new StandardMaterial(`textplane-material-${text}`, scene)
   material.diffuseTexture = texture
   material.emissiveColor = new Color3(0.6, 0.6, 0.6)
   material.specularColor = Color3.Black()

   const plane = MeshBuilder.CreatePlane(`textplane-${text}`, { width, height }, scene)
   plane.material = material
   return plane
}
