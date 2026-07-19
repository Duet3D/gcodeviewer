import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { Color4, Color3 } from '@babylonjs/core/Maths/math.color'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { ArcRotateCameraKeyboardMoveInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraKeyboardMoveInput'
import { Light } from '@babylonjs/core/Lights/light'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { FlyCamera } from '@babylonjs/core/Cameras/flyCamera'
import Processor from './processor'
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation'
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import '@babylonjs/core/Engines/Extensions/engine.query'
import GPUPicker from './gpupicker'
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents'
import { Plane } from '@babylonjs/core/Maths/math.plane'
import ViewBox, { ViewBoxDirection } from './Renderables/viewbox'
import Bed, { BuildVolume, RenderBedMode } from './Renderables/bed'
import Axes from './Renderables/axes'
import BuildObjects from './Renderables/buildobjects'
import '@babylonjs/core/Rendering/'

export default class Viewer {
   scene: Scene | undefined
   engine: Engine | null = null
   orbitCamera: ArcRotateCamera | null = null
   flyCamera: FlyCamera | null = null
   offscreenCanvas: OffscreenCanvas | HTMLCanvasElement
   box: Mesh
   boxRotation: number
   light: Light
   pointLight: PointLight
   lastTimeStamp: number
   x: number = 1
   y: number = 1
   z: number = 1
   pause: boolean = false
   registeredEventHandlers = new Map<string, any>() //These are event handlers we want to bind to. Currently Canvas, Window, Document that we fake in the worker.
   worker: Worker
   processor: Processor = new Processor()
   viewBox: ViewBox | null = null
   bed: Bed | null = null
   axes: Axes | null = null
   buildObjects: BuildObjects | null = null
   zTopClipValue: number | null = null
   zBottomClipValue: number | null = null
   // When false, clicking a rendered line no longer seeks the file position. The live job view turns
   // this off so the print head can't be scrubbed away from where the printer actually is
   allowSeek: boolean = true
   offscreen: boolean = true
   lastFrameUpdate: number = 0
   renderTimeout: number = 1000
   maxFrameRate = 1000 / 30
   // Mirrored from the main thread via visibilitychange - the worker's faked document has no
   // usable `hidden` property, so without this the render loop burns GPU in background tabs
   documentHidden = false

   // getBoundingInfo()
   rect = {
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      height: 0,
      width: 0,
   }

   constructor() {}

   //Init message worker
   init_worker(data: any, worker: Worker) {
      this.offscreen = true
      this.offscreenCanvas = data.offscreencanvas

      this.offscreenCanvas.addEventListener = (event, fn, opt) => {
         this.bindHandler('canvas', event, fn, opt) //we do this to capture eventtargets
      }

      this.setSizes(data.width, data.height)

      //@ts-expect-error getBoundingClientRect is not defined on offscreen canvas but necessary for babylonjs
      this.offscreenCanvas.getBoundingClientRect = () => {
         return this.rect
      }

      //@ts-expect-error focus is not defined on offscreen canvas but necessary for babylonjs
      this.offscreenCanvas.focus = () => {
         this.worker.postMessage({
            type: 'canvasMethod',
            method: 'focus',
            args: [],
         })
      }

      this.worker = worker
   }

   setSizes(width, height) {
      if (this.offscreen) {
         //@ts-expect-error clientWidth is readonly on the canvas types but assignable on the faked worker-side canvas
         this.offscreenCanvas.clientWidth = width
         //@ts-expect-error clientHeight is readonly on the canvas types but assignable on the faked worker-side canvas
         this.offscreenCanvas.clientHeight = height
         this.offscreenCanvas.width = width
         this.offscreenCanvas.height = height

         // Pointer coords are translated to canvas-relative in the proxy (viewer-proxy.ts) using the
         // live rect, so this faked rect stays at the origin and only needs the current size
         this.rect.right = this.rect.width = width
         this.rect.bottom = this.rect.height = height
      }
      if (this.engine) {
         this.engine.resize()
         this.processor.gpuPicker.updateRenderTargetSize(this.engine.getRenderWidth(), this.engine.getRenderHeight())
      }
   }

   async initEngine() {
      console.info(`G-Code Viewer- Sindarius - 4 `)

      //this will use the offscreen rendering and web worker threads
      this.engine = new Engine(this.offscreenCanvas, true, {
         doNotHandleContextLost: true,
      }) //WebGPU does not currently have a constructor that takes offscreen canvas

      this.engine.enableOfflineSupport = false

      this.scene = new Scene(this.engine)

      this.scene.clearColor = new Color4(0.3, 0.3, 0.3, 1)
      //this.scene.useOrderIndependentTransparency = true
      //this.scene.depthPeelingRenderer.passCount = 2

      if (this.offscreen) {
         this.scene.doNotHandleCursors = true //We can't make cursor changes in the worker thread
      }
      //this.scene.performancePriority = ScenePerformancePriority.Intermediate //.Aggressive
      //this.scene.autoClear = true
      this.scene.skipPointerMovePicking = true

      this.processor.scene = this.scene
      this.processor.worker = this.worker
      this.processor.gpuPicker = new GPUPicker(
         this.scene,
         this.engine,
         this.offscreenCanvas.width,
         this.offscreenCanvas.height,
      )
      
      // Initialize nozzle
      this.processor.initNozzle(0.4)

      //Orbit Cam
      this.orbitCamera = new ArcRotateCamera('Camera', Math.PI / 2, 2.356194, 15, new Vector3(0, 0, 0), this.scene)
      this.orbitCamera.invertRotation = false
      this.orbitCamera.attachControl(this.offscreenCanvas, true)
      // Camera movement changes what sits under the (possibly resting) pointer
      this.orbitCamera.onViewMatrixChangedObservable.add(() => this.processor.gpuPicker.requestPick())
      this.orbitCamera.maxZ = 100000
      this.orbitCamera.lowerRadiusLimit = 5
      this.orbitCamera.setPosition(new Vector3(150, 100, 0))
      this.orbitCamera.setTarget(new Vector3(150, 0, 150))

      //Cam properties
      this.orbitCamera.speed = 500
      this.orbitCamera.inertia = 0
      this.orbitCamera.panningInertia = 0
      const keyboardInput = this.orbitCamera.inputs.attached.keyboard as ArcRotateCameraKeyboardMoveInput
      keyboardInput.angularSpeed = 0.05
      keyboardInput.zoomingSensibility = 0.5
      keyboardInput.panningSensibility = 0.5
      this.orbitCamera.angularSensibilityX = 200
      this.orbitCamera.angularSensibilityY = 200
      this.orbitCamera.panningSensibility = 2
      this.orbitCamera.wheelPrecision = 0.25

      this.pointLight = new PointLight('pl', new Vector3(0, 1, -1), this.scene)

      this.pointLight.diffuse = new Color3(1, 1, 1)
      this.pointLight.specular = new Color3(1, 1, 1)

      this.bed = new Bed(this.scene)
      this.bed.registerClipIgnore = (mesh) => {
         this.registerClipIgnore(mesh)
      }
      this.bed.buildBed()

      this.axes = new Axes(this.scene)
      this.axes.registerClipIgnore = (mesh) => {
         this.registerClipIgnore(mesh)
      }
      this.axes.render()

      this.buildObjects = new BuildObjects(this.scene)
      this.buildObjects.getMaxHeight = () => {
         return this.processor.processorProperties.maxHeight
      }
      this.buildObjects.registerClipIgnore = (mesh) => {
         this.registerClipIgnore(mesh)
      }
      this.buildObjects.objectCallback = (metadata) => {
         this.worker.postMessage({ type: 'objectSelected', object: metadata })
      }
      this.buildObjects.labelCallback = (name) => {
         this.worker.postMessage({ type: 'objectLabel', name: name })
      }

      this.viewBox = new ViewBox(this.engine, this.orbitCamera)
      this.viewBox.onDirectionSelected = (direction) => {
         this.setCameraDirection(direction)
      }

      this.resetCamera()

      this.scene.render()

      //limit frames
      let deltaTime = 0
      this.engine.runRenderLoop(() => {
         if (this.documentHidden) return

         deltaTime += this.engine.getDeltaTime()
         if (deltaTime > this.maxFrameRate) {
            deltaTime = 0
         } else {
            return
         }

         this.pointLight.position = this.orbitCamera?.position ?? new Vector3(0, 0, 0)
         
         // Update nozzle animations
         const nozzle = this.processor.getNozzle()
         if (nozzle) {
            nozzle.update()
         }
         
         this.scene?.render()
         this.viewBox?.render()
         this.lastFrameUpdate = Date.now()
      })

      this.scene.onPointerObservable.add((pointerInfo) => {
         if (pointerInfo.type == PointerEventTypes.POINTERTAP) {
            const direction = this.viewBox?.pick(this.scene.pointerX, this.scene.pointerY)
            if (direction) {
               // Middle-click on the cube returns to the default framing; left-click snaps to the
               // clicked face/edge/corner
               if ((pointerInfo.event as any)?.button === 1) {
                  this.resetCamera()
               } else {
                  this.setCameraDirection(direction)
               }
               return
            }
            try {
               if (this.allowSeek && this.processor.focusedColorId > 10) {
                  const pos = this.processor.gCodeLines[this.processor.focusedColorId].filePosition
                  this.processor.updateFilePosition(pos)
                  this.worker.postMessage({ type: 'positionupdate', position: pos })
               }
            } catch {}
         }
      })

      //this.loadInstrumentation()

      // The scene, bed, axes, camera and build-object machinery are all created above in this async
      // method. Signal the main thread that configuration messages (build volume, bed, tools,
      // camera) can now be applied without racing an undefined scene
      this.worker.postMessage({ type: 'ready' })
   }

   // Snap the orbit camera so it views the bed from the given direction (viewbox face/edge/corner metadata)
   setCameraDirection(direction: ViewBoxDirection) {
      if (!this.orbitCamera || !this.bed) {
         return
      }
      const look = new Vector3(direction.x, direction.y, direction.z)
      if (look.lengthSquared() === 0) {
         return
      }
      look.normalize()
      const bedCenter = this.bed.getCenter()
      const bedSize = this.bed.getSize()
      // Straight-on views need more distance than corner views to keep the bed fully in frame
      const zeroAxes = (direction.x === 0 ? 1 : 0) + (direction.y === 0 ? 1 : 0) + (direction.z === 0 ? 1 : 0)
      const distance = Math.max(bedSize.x, bedSize.y, bedSize.z) * (zeroAxes === 2 ? 1.75 : 1.35)
      const target = new Vector3(bedCenter.x, bedCenter.z, bedCenter.y)
      this.orbitCamera.setTarget(target)
      this.orbitCamera.setPosition(target.subtract(look.scale(distance)))
      if (direction.x === 0 && direction.z === 0) {
         this.orbitCamera.alpha = (3 * Math.PI) / 2
      }
      this.scene?.render(true)
   }

   resetCamera() {
      if (!this.orbitCamera || !this.bed) {
         return
      }
      const bedCenter = this.bed.getCenter()
      const bedSize = this.bed.getSize()
      // Front view tilted 45 deg down: alpha -PI/2 faces the front edge, beta PI/4 is the tilt.
      // Babylon space maps G-code X -> x, height -> y (up), G-code Y -> z, so the bed centre's y
      // (G-code Y) becomes the Babylon z target
      const footprint = Math.max(bedSize.x, bedSize.y, 1)
      // Aim below the plate so the bed rides in the upper-middle of the frame, leaving room at the
      // bottom for the playback controls (the historical DWC framing)
      this.orbitCamera.setTarget(new Vector3(bedCenter.x, -footprint * 0.12, bedCenter.y))
      this.orbitCamera.alpha = -Math.PI / 2
      this.orbitCamera.beta = Math.PI / 4
      // Pull back far enough to frame the whole bed footprint (bedSize.x/y are the G-code X/Y spans)
      this.orbitCamera.radius = footprint * (this.bed.isDelta ? 1.1 : 1.2)
      this.scene?.render(true)
   }

   // World-space bounding box of the loaded print, unioned across the rendered meshes' thin instances.
   // Null when nothing is loaded, so callers fall back to bed framing
   private getPrintBoundingBox(): { min: Vector3; max: Vector3 } | null {
      const meshes = this.processor?.meshes
      if (!meshes || meshes.length === 0) {
         return null
      }
      let min: Vector3 | null = null
      let max: Vector3 | null = null
      for (const mesh of meshes) {
         if (!mesh || mesh.thinInstanceCount === 0) {
            continue
         }
         mesh.thinInstanceRefreshBoundingInfo(true)
         const box = mesh.getBoundingInfo().boundingBox
         min = min ? Vector3.Minimize(min, box.minimumWorld) : box.minimumWorld.clone()
         max = max ? Vector3.Maximize(max, box.maximumWorld) : box.maximumWorld.clone()
      }
      return min && max ? { min, max } : null
   }

   // Front view tilted 45 deg down, framed to the printed geometry rather than the whole bed (used by
   // the embedded job view); falls back to bed framing when nothing is loaded yet
   frameToPrint() {
      const bounds = this.getPrintBoundingBox()
      if (!bounds || !this.orbitCamera) {
         this.resetCamera()
         return
      }
      const center = bounds.min.add(bounds.max).scale(0.5)
      const size = bounds.max.subtract(bounds.min)
      const span = Math.max(size.x, size.y, size.z, 1)
      this.orbitCamera.setTarget(new Vector3(center.x, center.y - span * 0.12, center.z))
      this.orbitCamera.alpha = -Math.PI / 2
      this.orbitCamera.beta = Math.PI / 4
      this.orbitCamera.radius = span * 1.5
      this.scene?.render(true)
   }

   // Report the print's Z extent (Babylon y is height) so the main thread can bound the clip sliders
   postPrintBounds() {
      const bounds = this.getPrintBoundingBox()
      this.worker.postMessage({
         type: 'printbounds',
         minHeight: bounds ? bounds.min.y : 0,
         maxHeight: bounds ? bounds.max.y : 0,
      })
   }

   // Excluded meshes (bed, axes, object boundaries) temporarily lift the clip planes while they render
   registerClipIgnore(mesh) {
      if (!mesh) {
         return
      }
      mesh.onBeforeRenderObservable.add(() => {
         this.scene.clipPlane = null
         this.scene.clipPlane2 = null
      })
      mesh.onAfterRenderObservable.add(() => {
         if (this.zTopClipValue !== null && this.zBottomClipValue !== null) {
            this.scene.clipPlane = new Plane(0, 1, 0, this.zTopClipValue)
            this.scene.clipPlane2 = new Plane(0, -1, 0, this.zBottomClipValue)
         }
      })
   }

   setAllowSeek(enabled: boolean) {
      this.allowSeek = enabled
   }

   showViewBox(visible: boolean) {
      this.viewBox?.show(visible)
   }

   setBackgroundColor(hexColor: string) {
      if (this.scene) {
         this.scene.clearColor = Color3.FromHexString(hexColor.substring(0, 7)).toColor4(1)
      }
   }

   setCameraInertia(enabled: boolean) {
      if (this.orbitCamera) {
         this.orbitCamera.inertia = enabled ? 0.9 : 0
         this.orbitCamera.panningInertia = enabled ? 0.9 : 0
      }
   }

   // Clip the model between two heights. Values are in printer Z, which maps to Babylon y
   setZClipPlane(top: number, bottom: number) {
      if (!this.scene) {
         return
      }
      if (top === null || top === undefined) {
         this.zTopClipValue = null
         this.zBottomClipValue = null
         this.scene.clipPlane = null
         this.scene.clipPlane2 = null
      } else {
         this.zTopClipValue = bottom > top ? bottom + 1 : -top
         this.zBottomClipValue = bottom
         this.scene.clipPlane = new Plane(0, 1, 0, this.zTopClipValue)
         this.scene.clipPlane2 = new Plane(0, -1, 0, this.zBottomClipValue)
      }
      this.processor.gpuPicker.requestPick()
      this.scene.render(true)
   }

   setBuildVolume(volume: BuildVolume) {
      if (this.bed) {
         this.bed.buildVolume = volume
         this.bed.commitBedSize()
         this.axes?.render()
         this.scene?.render(true)
      }
   }

   setBedRenderMode(mode: RenderBedMode) {
      this.bed?.setRenderMode(mode)
   }

   setBedColor(color: string) {
      this.bed?.setBedColor(color)
   }

   // Colour used for not-yet-printed geometry in progress mode (hex string, e.g. "#FFFFFFFF")
   setProgressColor(color: string) {
      const c = Color4.FromHexString(color.padEnd(9, 'F'))
      this.processor.modelMaterial.forEach((m) => m.setProgressColor([c.r * 255, c.g * 255, c.b * 255, c.a * 255]))
   }

   // Opacity (0-1) of not-yet-printed geometry while alpha mode is on
   setTransparencyValue(value: number) {
      this.processor.modelMaterial.forEach((m) => m.setAlphaValue(value))
   }

   // Show/hide the printed travel (non-extruding) moves
   setShowTravels(show: boolean) {
      this.processor.modelMaterial.forEach((m) => m.setShowTravels(show))
   }

   // Playback speed multiplier for the nozzle animation (the scrubber's play button)
   setAnimationSpeed(speed: number) {
      this.processor.getNozzle()?.setAnimationSpeed(speed)
   }

   setDeltaBed(isDelta: boolean) {
      this.bed?.setDelta(isDelta)
   }

   showBed(visible: boolean) {
      this.bed?.setVisibility(visible)
   }

   showAxes(visible: boolean) {
      this.axes?.show(visible)
   }

   loadObjectBoundaries(objects: any[]) {
      this.buildObjects?.loadObjectBoundaries(objects)
   }

   showObjectSelection(visible: boolean) {
      this.buildObjects?.showObjectSelection(visible)
   }

   showObjectLabels(visible: boolean) {
      this.buildObjects?.showLabels(visible)
   }

   isArcRotateCameraStopped(camera) {
      return (
         camera.inertialAlphaOffset === 0 &&
         camera.inertialBetaOffset === 0 &&
         camera.inertialRadiusOffset === 0 &&
         camera.inertialPanningX === 0 &&
         camera.inertialPanningY === 0
      )
   }

   loadInstrumentation() {
      const inst = new EngineInstrumentation(this.engine)
      inst.captureGPUFrameTime = true
      inst.captureShaderCompilationTime = true

      const sceneInst = new SceneInstrumentation(this.scene)

      let timer = Date.now()
      this.scene.registerAfterRender(() => {
         if (Date.now() - timer > 1000) {
            timer = Date.now()
            console.log('current frame time (GPU): ' + (inst.gpuFrameTimeCounter.current * 0.000001).toFixed(2) + 'ms')
            console.log(this.scene.meshes.length)
            console.log(`average draw calls ${sceneInst.drawCallsCounter.current}`)
         }
      })
   }

   async loadFile(file) {
      await this.processor.loadFile(file)
   }

   setMaxFPS(fps) {
      console.log(fps)
      if (fps <= 0) fps = 1
      this.maxFrameRate = 1000 / fps
   }

   //Send message to the main thread for events we want to bind to.
   bindHandler(targetName, eventName, fn, opt) {
      const id = `${targetName}${eventName}`
      this.registeredEventHandlers.set(id, fn)

      this.worker.postMessage({
         type: 'event',
         targetName: targetName,
         eventName: eventName,
         opt: opt,
      })
   }

   //We get back events from the main thread and need to handle them here to trigger babylonjs events.
   handleEvent(eventType, event) {
      const handlerId = `${event.targetName}${event.eventName}`
      event.eventClone.preventDefault = this.noop
      event.eventClone.target = this.offscreenCanvas
      this.registeredEventHandlers.get(handlerId)(event.eventClone)
   }

   noop() {}

   unload() {
      // The proxy terminates this worker only after unloadComplete arrives, so it must be posted
      // even if dispose throws - a worker leaked here keeps its render loop running forever
      try {
         this.engine.dispose()
      } finally {
         this.scene = null
         this.engine = null
         this.worker.postMessage({ type: 'unloadComplete', params: [] })
      }
   }
}
