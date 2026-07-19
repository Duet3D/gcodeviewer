import { Engine } from '@babylonjs/core/Engines/engine'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Scene } from '@babylonjs/core/scene'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { Color4 } from '@babylonjs/core/Maths/math.color'
import '@babylonjs/core/Engines/thinEngine'

export default class GPUPicker {
   scene: Scene
   engine: Engine
   renderTarget: RenderTargetTexture
   width: number
   height: number
   colorTestCallBack: any
   currentPosition: number = 0
   renderTargetMeshs: Mesh[] = []
   // Reused across frames - the readback runs every rendered frame, so a fresh framebuffer per call
   // would pile up GL objects faster than the GC reclaims them
   pickFrameBuffer: WebGLFramebuffer | null = null
   pickPixelBuffer = new Uint8Array(4)

   //  shaderMaterial: CustomMaterial
   shaderMaterial: ShaderMaterial
   constructor(scene: Scene, engine: Engine, width: number, height: number) {
      this.scene = scene
      this.engine = engine
      this.width = width
      this.height = height
      this.renderTarget = new RenderTargetTexture('rt', { width, height }, this.scene, true)
      this.renderTarget.clearColor = new Color4(0, 0, 0, 0)
      // Rendering the pick target redraws the entire model and stalls on a synchronous readPixels,
      // so it only runs on demand (requestPick) instead of every frame
      this.renderTarget.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
      this.scene.customRenderTargets.push(this.renderTarget)

      let lastPointerX = -1
      let lastPointerY = -1
      this.scene.onBeforeRenderObservable.add(() => {
         if (this.scene.pointerX !== lastPointerX || this.scene.pointerY !== lastPointerY) {
            lastPointerX = this.scene.pointerX
            lastPointerY = this.scene.pointerY
            this.requestPick()
         }
      })
      this.shaderMaterial = new ShaderMaterial(
         'pick_mat',
         this.scene,
         {
            vertexSource: vertexShader,
            fragmentSource: fragmentShader,
         },
         {
            attributes: ['position', 'pickColor', 'filePosition', 'tool'],
            uniforms: [
               'world',
               'worldView',
               'worldViewProjection',
               'view',
               'projection',
               'viewProjection',
               'currentPosition',
            ],
         },
      )

      let isEnabled = false
      this.renderTarget.onBeforeRenderObservable.add(() => {
         if (this.renderTargetMeshs) {
            isEnabled = this.renderTargetMeshs[0]?.isEnabled() ?? false
            this.renderTargetMeshs.forEach((m) => m.setEnabled(true))
         } else {
            //console.log('no target')
         }
      })
      this.renderTarget.onAfterRenderObservable.add(() => {
         if (this.renderTargetMeshs.length === 0) {
            return
         }

         if (this.colorTestCallBack) {
            const x = Math.round(this.scene.pointerX)
            const y = this.height - Math.round(this.scene.pointerY)
            this.colorTestCallBack(this.readTexturePixels(this.engine._gl, this.renderTarget._texture._hardwareTexture.underlyingResource, x, y))
         }

         if (!isEnabled) this.renderTargetMeshs.forEach((m) => m.setEnabled(false))
      })
   }

   readTexturePixels(gl, texture, x, y) {
      if (!this.pickFrameBuffer) {
         this.pickFrameBuffer = gl.createFramebuffer()
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFrameBuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pickPixelBuffer)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)

      return this.pickPixelBuffer
   }

   // Schedule one pick-target render on the next frame. Anything that changes what sits under the
   // pointer must call this: pointer movement, camera movement, file position, clip planes, meshes
   requestPick() {
      this.renderTarget.resetRefreshCounter()
   }

   updateRenderTargetSize(width, height) {
      this.width = width
      this.height = height
      this.renderTarget.resize({ width, height })
      this.requestPick()
   }

   clearRenderList() {
      this.renderTarget.renderList = []
      this.renderTargetMeshs = []
   }

   addToRenderList(mesh: Mesh) {
      this.renderTargetMeshs.push(mesh)
      this.renderTarget.setMaterialForRendering(this.renderTargetMeshs, this.shaderMaterial)
      this.renderTarget.renderList.push(mesh)
      this.requestPick()
   }

   updateCurrentPosition(currentPosition: number) {
      this.currentPosition = currentPosition
      this.shaderMaterial.setFloat('currentPosition', this.currentPosition)
      this.requestPick()
   }
}

const vertexShader = `
// Vertex shader
#if defined(WEBGL2) || defines(WEBGPU)
precision highp sampler2DArray;
#endif
precision highp float;

        // Attributes
        attribute vec3 position;
         attribute vec3 pickColor;
         attribute float filePosition;
         attribute float tool;

        // Uniforms
        uniform mat4 viewProjection;
        uniform float currentPosition;


        //to fragment

        flat out vec4 vPickColor;
        flat out float vShow;
        flat out float fTool;

#include<instancesDeclaration>


void main(void) {
   #include<instancesVertex>
   gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
   vPickColor = vec4(pickColor, 1.0);
   vShow = currentPosition - filePosition;
   fTool = tool;
}
`

const fragmentShader = `
// Fragment shader
#if defined(PREPASS)
#extension GL_EXT_draw_buffers : require
layout(location = 0) out highp vec4 glFragData[SCENE_MRT_COUNT];
highp vec4 gl_FragColor;
#endif
#if defined(WEBGL2) || defines(WEBGPU)
precision highp sampler2DArray;
#endif
precision highp float;

uniform mat4 u_World;
uniform mat4 u_ViewProjection;
uniform vec4 u_color;


flat in vec4 vPickColor;
flat in float vShow;
flat in float fTool;

#include<helperFunctions>

void main(void) {
   if(vShow < 0.0f || fTool >= 255.0)
   {
      discard;
   }
   else
   {
      gl_FragColor = vPickColor;
      #ifdef CONVERTTOLINEAR0
      gl_FragColor = toLinearSpace(gl_FragColor);
      #endif
      #ifdef CONVERTTOGAMMA0
      gl_FragColor = toGammaSpace(gl_FragColor);
      #endif
      #if defined(PREPASS)
      gl_FragData[0] = gl_FragColor;
      #endif
   }
}
`
