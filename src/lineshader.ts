import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { Scene } from '@babylonjs/core/scene'
import { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector'
import '@babylonjs/core/Materials/standardMaterial'

// Clock shared by the trail fade uniforms and the position history recorded in the processor. Both
// must use the same epoch, and raw performance.now() loses sub-second resolution once cast to float32
const trailEpoch = performance.now()

export function trailTime(): number {
   return (performance.now() - trailEpoch) / 1000
}

export default class LineShaderMaterial {
   scene: Scene
   material: ShaderMaterial
   toolBuffer: UniformBuffer
   renderMode = 0

   // Number of position/time samples the trail fade interpolates over. The processor keeps the same
   // number and pads the unused front slots, so index TRAIL_HISTORY_SIZE - 1 is always the newest
   static readonly trailHistorySize = 64

   static readonly vertexShader = `
   #define THIN_INSTANCES
   #define TRAIL_HISTORY_SIZE ${LineShaderMaterial.trailHistorySize}
   precision highp float;
   

   attribute vec3 position;
   attribute vec3 normal;

   attribute float filePosition;
   attribute vec3 pickColor;
   attribute float tool;
   attribute float feedRate;
   attribute float filePositionEnd;
   attribute float isPerimeter;
   attribute vec3 baseColor;

   uniform mat4 viewProjection;
   uniform mat4 worldView;
   uniform mat4 view;

   uniform float trailDuration;
   uniform vec3 trailColor;
   uniform float currentTime;
   uniform float trailStartPosition;
   uniform vec2 posHistory[TRAIL_HISTORY_SIZE];
   uniform float currentPosition;
   uniform vec4 toolColors[20];
   uniform vec3 focusedPickColor;
   uniform float maxFeedRate;
   uniform float minFeedRate;
   uniform bool progressMode;
   uniform vec4 progressColor;
   uniform bool showSupports;
   uniform bool showTravels;
   uniform bool persistTravels;
   uniform vec3 minFeedColor;
   uniform vec3 maxFeedColor;
   uniform int renderMode;

   uniform bool alphaMode;
   uniform bool lineMesh;
   uniform bool perimeterOnly;

   varying vec3 eye_normal;
   varying vec3 eye_pos;

#include<clipPlaneVertexDeclaration>

   flat out vec3 vDiffColor;
   flat out float fIsPerimeter;
   flat out float bDiscard;
   flat out float fShow;
   flat out float focused;

 #include<instancesDeclaration>

   // Seconds since the print head passed a file offset. Samples run oldest to newest and the head only
   // ever moves forward, so scanning backwards finds the bracketing pair to interpolate between
   float secondsSincePrinted(float pos)
   {
      float passedAt = posHistory[0].y;
      for (int i = TRAIL_HISTORY_SIZE - 1; i >= 0; i--)
      {
         if (posHistory[i].x <= pos)
         {
            passedAt = posHistory[i].y;
            if (i < TRAIL_HISTORY_SIZE - 1)
            {
               float span = posHistory[i + 1].x - posHistory[i].x;
               if (span > 0.0)
               {
                  passedAt = mix(posHistory[i].y, posHistory[i + 1].y, clamp((pos - posHistory[i].x) / span, 0.0, 1.0));
               }
            }
            break;
         }
      }
      return currentTime - passedAt;
   }

   void main()
   {
      #include<instancesVertex>

      fIsPerimeter = isPerimeter;
      bDiscard = 0.;

      // Non-perimeter geometry (infill, travels) is dropped entirely in perimeter-only mode
      if(perimeterOnly && isPerimeter < 1.0)
      {
         bDiscard = 1.;
      }

      switch(renderMode){
            case 0: 
               vDiffColor = baseColor.rgb; 
            break; // use default diffuse color;
            case 1:
               if(tool < 255.0)
               {
                  vDiffColor = toolColors[int(tool)].rgb;
               }
               else
               {
                  vDiffColor = vec3(1,0,0); //Travel Color Make Configurable at some point
               }
            break;
            case 2:
               float m = (feedRate - minFeedRate) / max(maxFeedRate - minFeedRate, 0.0001);
               vDiffColor = mix(minFeedColor, maxFeedColor, clamp(m, 0.0, 1.0));
               break;
            case 5:
               vDiffColor = pickColor.rgb;
               break;
         }

         fShow = currentPosition - filePosition;
         focused = 0.;

         // Anything older than the first sample has left the trail, so skip the history scan for it
         float age = (fShow >= 0.0 && filePosition >= trailStartPosition) ? secondsSincePrinted(filePosition) : trailDuration;

         if(focusedPickColor == pickColor && !(currentPosition >= filePosition && currentPosition <= filePositionEnd)) 
         {
            vDiffColor = vec3(1, 1, 1) - vDiffColor.rgb;
            focused = 1.;
         }
         else if (tool >= 254.0)  //Travel
         {
            if(!showTravels)
            {
               bDiscard = 1.;
            }
            else if(fShow >= 0.0 && age < trailDuration / 8.0)
            {
                  vDiffColor = mix(vec3(1.0, 0.0, 0.0), vec3(0.5,0.0,0.0), age / (trailDuration / 8.0));
            }
            else if (fShow >= 0.0)
            {
               vDiffColor = vec3(0.3, 0.5, 0.8);
               bDiscard = persistTravels ? 0. : 1.;
            }
            else if (alphaMode || progressMode)
            {
               vDiffColor = vec3(0.3, 0.5, 0.8);
            }
            else
            {
               bDiscard = 1.;
            }
         }
         else //Extrusion
         {
            if (fShow >= 0.0  && age < trailDuration)
            {
               if(currentPosition < filePositionEnd)
               {
                  vDiffColor = trailColor;
               }
               else
               {
                  vDiffColor = mix(trailColor, vDiffColor.rgb, age / trailDuration);
               }
            }
            else if (fShow < 0.0 && progressMode)
            {
               vDiffColor = progressColor.rgb;
            }
            else if(fShow < 0.0 && !alphaMode && !progressMode)
            {
               bDiscard = 1.;
            }
         }

         //Final Results
         vec4 worldPos = finalWorld * vec4(position, 1.0);
         #include<clipPlaneVertex>
         gl_Position = viewProjection * worldPos;
         mat4 n =transpose(inverse(worldView * finalWorld));
         eye_normal = (n * vec4(normal, 0.0)).xyz;
         eye_pos = (worldView * finalWorld * vec4(position, 1.0)).xyz;
   }`

   static readonly fragmentShader = `
   precision highp float;
   #include<helperFunctions>

   const vec3 LIGHT_TOP_DIR = vec3(-0.4574957, 0.4574957, 0.7624929);
   const vec3 LIGHT_FRONT_DIR = vec3(0.0, 0.0, 1.0);
   
   // x = ambient, y = top diffuse, z = front diffuse, w = global
   const vec4 light_intensity = vec4(0.45, 0.7, 0.75, 0.75);
   const float SPECULAR_POWER = 32.0;
   const float SPECULAR_INTENSITY = 0.35;
   varying vec3 eye_normal;
   varying vec3 eye_pos;

#include<clipPlaneFragmentDeclaration>

   uniform bool lineMesh;
   uniform bool alphaMode;
   uniform bool progressMode;
   uniform float unprintedOpacity;
   uniform bool useSpecular;

   flat in vec3 vDiffColor;
   flat in float fIsPerimeter;
   flat in float bDiscard;
   flat in float fShow;
   flat in float focused;
   const vec3 lowerBound = vec3(0.3,0.3,0.3);

   void main(){
         #include<clipPlaneFragment>

         if( bDiscard > 0.0) {
            discard;
         }

         vec4 diffuseColor = vec4(vDiffColor, 1);

         if(focused > 0.) 
         {
            diffuseColor.a = 1.0;
         }
         else if(progressMode && fShow < 0.0)
         {
            diffuseColor.a = unprintedOpacity;
         }
         else
         {
            diffuseColor.a = fShow >= 0.0 || !alphaMode ? 0.99 : unprintedOpacity;
         }
         
        if(lineMesh) {
            if(fIsPerimeter < 1.0)
            {
               if(all(lessThan(diffuseColor.rgb,lowerBound.rgb))) {
                  diffuseColor = vec4(diffuseColor.rgb + lowerBound, diffuseColor.a);
               }
               else {
                  diffuseColor = vec4(diffuseColor.rgb - lowerBound, diffuseColor.a);
               }
            }
            else
            {
            diffuseColor = vec4(diffuseColor.rgb, diffuseColor.a);
            }
            gl_FragColor = diffuseColor;
         }
         else
         {
            vec3 normal = normalize(eye_normal);
            float NdotL = abs(dot(normal, LIGHT_TOP_DIR));
            float intensity = light_intensity.x + NdotL * light_intensity.y;
            NdotL = abs(dot(normal, LIGHT_FRONT_DIR));
            intensity += NdotL * light_intensity.z;
            vec3 shaded = diffuseColor.rgb * light_intensity.w * intensity;
            if(useSpecular)
            {
               vec3 halfDir = normalize(LIGHT_TOP_DIR + normalize(-eye_pos));
               shaded += vec3(pow(max(dot(normal, halfDir), 0.0), SPECULAR_POWER) * SPECULAR_INTENSITY);
            }
            gl_FragColor = vec4(shaded, diffuseColor.a);
         }
   }`

   constructor(scene: Scene) {
      this.scene = scene
      this.buildMaterial()
   }

   buildMaterial() {
      this.material = new ShaderMaterial(
         `line_shader`,
         this.scene,
         {
            vertexSource: LineShaderMaterial.vertexShader,
            fragmentSource: LineShaderMaterial.fragmentShader,
         },
         {
            attributes: [
               'position',
               'normal',
               'baseColor',
               'filePosition',
               'filePositionEnd',
               'pickColor',
               'tool',
               'feedRate',
               'isPerimeter',
               'baseColor',
            ],
            uniforms: [
               'world',
               'worldView',
               'worldViewProjection',
               'view',
               'projection',
               'viewProjection',
               'trailDuration',
               'trailColor',
               'currentTime',
               'trailStartPosition',
               'posHistory',
               'currentPosition',
               'renderMode',
               'toolColors',
               'focusedPickColor',
               'maxFeedRate',
               'minFeedRate',
               'alphaMode',
               'unprintedOpacity',
               'progressMode',
               'progressColor',
               'lineMesh',
               'perimeterOnly',
               'showSupports',
               'showTravels',
               'persistTravels',
               'minFeedColor',
               'maxFeedColor',
               'useSpecular',
            ],
            // Off by default in ShaderMaterial, and without it the Z clipping planes set on
            // the scene never reach this material
            useClipPlane: true,
         },
      )

      this.material.alpha = 0.99
      this.material.forceDepthWrite = true

      //Set defaults
      this.material.setFloat('trailDuration', 20)
      this.material.setVector3('trailColor', new Vector3(1, 1, 1))
      this.material.setFloat('trailStartPosition', Number.MAX_SAFE_INTEGER)
      this.material.setArray2('posHistory', new Array(LineShaderMaterial.trailHistorySize * 2).fill(0))
      this.material.setVector4('progressColor', new Vector4(0, 1, 0, 1))
      this.material.setFloat('unprintedOpacity', 0.05)
      this.material.setInt('showTravels', 0)
      this.material.setInt('persistTravels', 0)
      this.material.setInt('useSpecular', 0)
      this.material.setVector3('minFeedColor', new Vector3(0, 0, 1))
      this.material.setVector3('maxFeedColor', new Vector3(1, 0, 0))
      this.material.setInt('perimeterOnly', 0)
      this.material.setInt('lineMesh', 0)

      //Per loop
      this.material.onBindObservable.add(() => {
         this.material.getEffect()?.setFloat('currentTime', trailTime())
      })
   }

   // All uniforms go through ShaderMaterial's persistent store (setFloat/setInt/...), which re-uploads
   // them on every bind. Never queue them via onBindObservable.addOnce: materials on disabled mesh
   // variants (2 of every 3 in each [box, cyl, line] triple) never bind, so such observers accumulate
   // without bound and eventually OOM the worker

   updateRenderMode(mode: number) {
      this.renderMode = mode
      this.material.setInt('renderMode', mode)
   }

   updateCurrentFilePosition(position: number) {
      this.material.setFloat('currentPosition', position)
   }

   // Position/time samples backing the trail fade, oldest first and padded to trailHistorySize
   updateTrailHistory(history: number[], startPosition: number) {
      this.material.setArray2('posHistory', history)
      this.material.setFloat('trailStartPosition', startPosition)
   }

   setTrailDuration(seconds: number) {
      this.material.setFloat('trailDuration', seconds)
   }

   setTrailColor(color: number[]) {
      this.material.setVector3('trailColor', new Vector3(color[0] / 255, color[1] / 255, color[2] / 255))
   }

   getMaterial() {
      if (this.material == null) {
         this.buildMaterial()
      }
      return this.material
   }

   updateToolColors(toolColors: number[]) {
      this.material.setArray4('toolColors', toolColors)
   }

   setPickColor(color: number[]) {
      this.material.setVector3('focusedPickColor', new Vector3(color[0] / 255, color[1] / 255, color[2] / 255))
   }

   setMaxFeedRate(feedRate: number) {
      this.material.setFloat('maxFeedRate', feedRate)
   }

   setMinFeedRate(feedRate: number) {
      this.material.setFloat('minFeedRate', feedRate)
   }

   setAlphaMode(mode: boolean) {
      this.material.setInt('alphaMode', mode ? 1 : 0)
   }

   // Opacity (0-1) of not-yet-printed geometry while alpha mode is on
   setUnprintedOpacity(value: number) {
      this.material.setFloat('unprintedOpacity', value)
   }

   setProgressMode(mode: boolean) {
      this.material.setInt('progressMode', mode ? 1 : 0)
   }

   setShowTravels(show: boolean) {
      this.material.setInt('showTravels', show ? 1 : 0)
   }

   setPersistTravels(persist: boolean) {
      this.material.setInt('persistTravels', persist ? 1 : 0)
   }

   setSpecular(enabled: boolean) {
      this.material.setInt('useSpecular', enabled ? 1 : 0)
   }

   setMinFeedColor(color: number[]) {
      this.material.setVector3('minFeedColor', new Vector3(color[0] / 255, color[1] / 255, color[2] / 255))
   }

   setMaxFeedColor(color: number[]) {
      this.material.setVector3('maxFeedColor', new Vector3(color[0] / 255, color[1] / 255, color[2] / 255))
   }

   setPerimeterOnly(mode: boolean) {
      this.material.setInt('perimeterOnly', mode ? 1 : 0)
   }

   setProgressColor(color: number[]) {
      this.material.setVector4('progressColor', new Vector4(color[0] / 255, color[1] / 255, color[2] / 255, color[3] / 255))
   }

   setLineMesh(mode: boolean) {
      this.material.setInt('lineMesh', mode ? 1 : 0)
   }

   showSupports(show: boolean) {
      // this.material.setInt('showSupports', show ? 1 : 0)
   }

   dispose() {
      if (this.material != null) {
         this.material.dispose()
         this.material = null
      }
   }
}
