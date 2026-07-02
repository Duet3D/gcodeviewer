import { Scene } from '@babylonjs/core/scene'
import { CustomMaterial } from '@babylonjs/materials/custom/customMaterial'
import { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector4, Vector3 } from '@babylonjs/core/Maths/math.vector'

export default class ModelMaterial {
   material: CustomMaterial
   toolBuffer: UniformBuffer
   renderMode = 0

   constructor(public scene: Scene) {
      this.buildMaterial()
   }

   buildMaterial() {
      this.material = new CustomMaterial('processor_mat', this.scene)

      this.material.specularColor = new Color3(0.2, 0.2, 0.2)
      this.material.emissiveColor = new Color3(0.4, 0.4, 0.4)

      //Alpha
      this.material.alpha = 0.99
      this.material.forceDepthWrite = true

      this.material.AddAttribute('filePosition')
      this.material.AddAttribute('filePositionEnd')
      this.material.AddAttribute('pickColor')
      this.material.AddAttribute('tool')
      this.material.AddAttribute('feedRate')
      this.material.AddAttribute('isPerimeter')
      this.material.AddAttribute('baseColor')

      this.material
         .AddUniform('animationLength', 'float', 5000)
         .AddUniform('currentPosition', 'float', 0)
         .AddUniform('renderMode', 'int', 0)
         .AddUniform('toolColors', 'vec4 [20]', new Float32Array(80))
         .AddUniform('focusedPickColor', 'vec3', new Vector3(0, 0, 0))
         .AddUniform('minFeedRate', 'float', 0)
         .AddUniform('maxFeedRate', 'float', 0)
         .AddUniform('utime', 'float', 0)
         .AddUniform('alphaMode', 'bool', 0)
         .AddUniform('progressMode', 'bool', 0)
         .AddUniform('progressColor', 'vec4', new Vector4(0, 1, 0, 1))
         .AddUniform('lineMesh', 'bool', 0)
         .AddUniform('showSupports', 'bool', 0)

      this.material.Vertex_Definitions(`
      attribute float filePosition;
      attribute vec3 pickColor;
      attribute float tool;
      attribute float feedRate;
      attribute float filePositionEnd;
      attribute float isPerimeter;
      attribute vec4 baseColor;

      flat out vec3 vDiffColor;
      flat out float fIsPerimeter;
      flat out float fShow;
      flat out float focused;
      out float bDiscard;
      
      `)

      this.material.Vertex_MainBegin(`

         fIsPerimeter = isPerimeter;

         switch(renderMode){
               case 0: 
                  vDiffColor = baseColor.rgb; 
               break; // use default diffuse color;
               case 1:
                  if(tool < 255.0) {                
                     vDiffColor = toolColors[int(tool)].rgb;
                  }
                  else{
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


      `)

      this.material.Vertex_MainEnd(`
         //vColor = vec4(1.); //prevent color from being applied against our diffuse

      `)

      this.material.Fragment_Definitions(`
             flat in vec3 vDiffColor;
             flat in float fIsPerimeter;
             flat in float fShow;
             flat in float focused;
             in float bDiscard;
             const vec3 lowerBound = vec3(0.3,0.3,0.3);
      `)

      this.material.Fragment_MainBegin(`
          if( bDiscard > 0.0) {
               discard;
            }
      `)

      this.material.Fragment_Custom_Diffuse(`
         diffuseColor = vDiffColor;
      `)

      this.material.Fragment_Before_FragColor(`
         if(lineMesh) {
            if(fIsPerimeter < 1.0){
               if(all(lessThan(diffuseColor.rgb,lowerBound.rgb))) {
                  color = vec4(diffuseColor.rgb + lowerBound, color.a);
               }
               else {
                  color = vec4(diffuseColor.rgb - lowerBound, color.a);
               }

            }
            else {
            color = vec4(diffuseColor.rgb, color.a);
            }
         }      

         if(focused > 0.) 
         {
            color.a = 1.0;
         }
         else
         {
            color.a = fShow >= 0.0 || !alphaMode ? 0.99 : 0.05; 
         }
      `)

      //Defaults
      this.material.onBindObservable.addOnce(() => {
         this.material.getEffect()?.setBool('lineMesh', false)
         //Set default bools here... does not appear to work on setuniform
         //this.material.getEffect()?.setBool('progressMode', true).setBool('alphaMode', true)
      })

      let time = 0
      this.material.onBindObservable.add(() => {
         time += this.scene.getEngine().getDeltaTime()
         this.material.getEffect()?.setFloat('utime', time)

         //this.material.getEffect()?.setFloat4('progresscolor', 0, 1, 0, 1.0)
      })
   }

   updateRenderMode(mode: number) {
      this.renderMode = mode
      this.material.onBindObservable.addOnce(() => {
         this.material.getEffect()?.setInt('renderMode', mode)
      })
   }

   updateCurrentFilePosition(position: number) {
      this.material.onBindObservable.addOnce(() => {
         this.material.getEffect()?.setFloat('currentPosition', position)
      })
   }

   getMaterial() {
      if (this.material == null) {
         this.buildMaterial()
      }
      return this.material
   }

   updateToolColors(toolColors: number[]) {
      this.material.onBindObservable.addOnce(() => {
         this.material.getEffect()?.setFloatArray4('toolColors', toolColors)
      })
   }

   setPickColor(color: number[]) {
      this.material.onBindObservable.addOnce(() => {
         this.material.getEffect()?.setFloat3('focusedPickColor', color[0] / 255, color[1] / 255, color[2] / 255)
      })
   }

   setMaxFeedRate(feedRate: number) {
      this.material.onBindObservable.addOnce(() => {
         this.material.getEffect()?.setFloat('maxFeedRate', feedRate)
      })
   }

   setMinFeedRate(feedRate: number) {
      this.material.onBindObservable.addOnce(() => {
         this.material.getEffect()?.setFloat('minFeedRate', feedRate)
      })
   }

   setAlphaMode(mode: boolean) {
      this.material.onBindObservable.addOnce(() => {
         this.material.getEffect()?.setBool('alphaMode', mode)
      })
   }

   setProgressMode(mode: boolean) {
      this.material.onBindObservable.addOnce(() => {
         this.material.getEffect()?.setBool('progressMode', mode)
      })
   }

   setProgressColor(color: number[]) {
      this.material.onBindObservable.addOnce(() => {
         this.material
            .getEffect()
            ?.setFloat4('progressColor', color[0] / 255, color[1] / 255, color[2] / 255, color[3] / 255)
      })
   }

   setLineMesh(mode: boolean) {
      this.material.onBindObservable.addOnce(() => {
         this.material.getEffect()?.setBool('lineMesh', mode)
      })
   }

   showSupports(show: boolean) {
      // this.material.onBindObservable.addOnce(() => {
      //    this.material.getEffect()?.setBool('showSupports', show)
      // })
   }

   dispose() {
      if (this.material != null) {
         this.material.dispose()
         this.material = null
      }
   }
}
