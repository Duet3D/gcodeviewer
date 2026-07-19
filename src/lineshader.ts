import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { Scene } from '@babylonjs/core/scene'
import { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector'
import '@babylonjs/core/Materials/standardMaterial'

export default class LineShaderMaterial {
   scene: Scene
   material: ShaderMaterial
   toolBuffer: UniformBuffer
   renderMode = 0

   static readonly vertexShader = `
   #define THIN_INSTANCES
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

   uniform float animationLength;
   uniform float currentPosition;
   uniform vec4 toolColors[20];
   uniform vec3 focusedPickColor;
   uniform float maxFeedRate;
   uniform float minFeedRate;
   uniform bool progressMode;
   uniform vec4 progressColor;
   uniform bool showSupports;
   uniform bool showTravels;
   uniform float utime;
   uniform int renderMode;

   uniform bool alphaMode;
   uniform bool lineMesh;
   uniform bool perimeterOnly;

   varying vec3 eye_normal;
   flat out vec3 vDiffColor;
   flat out float fIsPerimeter;
   flat out float bDiscard;
   flat out float fShow;
   flat out float focused;

 #include<instancesDeclaration>

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
               float m = (feedRate - minFeedRate) / (maxFeedRate - minFeedRate);
               vDiffColor = mix(vec3(0,0,1), vec3(1,0,0), m); 
               break;
            case 5:
               vDiffColor = pickColor.rgb;
               break;
         }

         fShow = currentPosition - filePosition;
         focused = 0.;

         if(focusedPickColor == pickColor && !(currentPosition >= filePosition && currentPosition <= filePositionEnd)) 
         {
            vDiffColor = vec3(1, 1, 1) - vDiffColor.rgb;
            focused = 1.;
         }
         else if (tool >= 254.0)  //Travel
         {
            if(fShow >= 0.0 && fShow < animationLength / 8.0)
            {
                  vDiffColor = mix(vec3(1.0, 0.0, 0.0), vec3(0.5,0.0,0.0), fShow / animationLength / 2.0);
            }
            else if (showTravels && fShow >= 0.0)
            {
               vDiffColor = vec3(0.3, 0.5, 0.8); // persistent travel lines
            }
            else
            {
               bDiscard = 1.;
            }
         }
         else //Extrusion
         {
            if (fShow >= 0.0  && fShow < animationLength) 
            { 
               if(currentPosition < filePositionEnd){
                  // float animation = smoothstep(0.0, 1.0, fract(utime / 50.0));
                  float animation = sin(2.0 * 3.1415 * utime / 1000.0) * 0.5 + 0.5;
                  vDiffColor = mix(vec3(0, 0, 1), vec3(0,1,0), animation);
               }
               else 
               {
                  vDiffColor = mix(vec3(1, 1, 1) - vDiffColor.rgb, vDiffColor.rgb, fShow / animationLength);
               }
            }
            else if (fShow >= 0.0 && progressMode) 
            {
               vDiffColor = progressColor.rgb;
            }
            else if(fShow < 0.0 && !alphaMode && !progressMode)
            {
               bDiscard = 1.;
            }
         }

         //Final Results
         gl_Position = viewProjection * finalWorld *  vec4(position, 1.0);
         mat4 n =transpose(inverse(worldView * finalWorld));
         eye_normal = (n * (vec4(normal , 1.0) * vec4(position,1.)) ).xyz;
   }`

   static readonly fragmentShader = `
   precision highp float;
   #include<helperFunctions>

   const vec3 LIGHT_TOP_DIR = vec3(-0.4574957, 0.4574957, 0.7624929);
   const vec3 LIGHT_FRONT_DIR = vec3(0.0, 0.0, 1.0);
   
   // x = ambient, y = top diffuse, z = front diffuse, w = global
   const vec4 light_intensity = vec4(0.45, 0.7, 0.75, 0.75);
   varying vec3 eye_normal;

   uniform bool lineMesh;
   uniform bool alphaMode;
   uniform bool progressMode;
   uniform float alphaValue;

   flat in vec3 vDiffColor;
   flat in float fIsPerimeter;
   flat in float bDiscard;
   flat in float fShow;
   flat in float focused;
   const vec3 lowerBound = vec3(0.3,0.3,0.3);

   void main(){

         if( bDiscard > 0.0) {
            discard;
         }

         vec4 diffuseColor = vec4(vDiffColor, 1);

         if(focused > 0.) 
         {
            diffuseColor.a = 1.0;
         }
         else
         {
            diffuseColor.a = fShow >= 0.0 || !alphaMode ? 0.99 : alphaValue;
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
            gl_FragColor = vec4(diffuseColor.rgb * light_intensity.w * intensity, diffuseColor.a);
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
               'animationLength',
               'currentPosition',
               'renderMode',
               'toolColors',
               'focusedPickColor',
               'maxFeedRate',
               'minFeedRate',
               'alphaMode',
               'alphaValue',
               'progressMode',
               'progressColor',
               'lineMesh',
               'perimeterOnly',
               'showSupports',
               'showTravels',
               'utime',
            ],
         },
      )

      this.material.alpha = 0.99
      this.material.forceDepthWrite = true

      //Set defaults
      this.material.setFloat('animationLength', 5000)
      this.material.setVector4('progressColor', new Vector4(0, 1, 0, 1))
      this.material.setFloat('alphaValue', 0.05)
      this.material.setInt('showTravels', 0)
      this.material.setInt('perimeterOnly', 0)
      this.material.setInt('lineMesh', 0)

      //Per loop
      let time = 0
      this.material.onBindObservable.add(() => {
         time += this.scene.getEngine().getDeltaTime()
         this.material.getEffect()?.setFloat('utime', time)
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
   setAlphaValue(value: number) {
      this.material.setFloat('alphaValue', value)
   }

   setProgressMode(mode: boolean) {
      this.material.setInt('progressMode', mode ? 1 : 0)
   }

   setShowTravels(show: boolean) {
      this.material.setInt('showTravels', show ? 1 : 0)
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
