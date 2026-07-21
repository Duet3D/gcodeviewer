import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { Color4, Color3 } from '@babylonjs/core/Maths/math.color'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { ArcRotateCameraKeyboardMoveInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraKeyboardMoveInput'
import { Light } from '@babylonjs/core/Lights/light'
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector'
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
import { Animation } from '@babylonjs/core/Animations/animation'
import { CubicEase, EasingFunction } from '@babylonjs/core/Animations/easing'
// Scene.beginDirectAnimation, which CreateAndStartAnimation needs, is only patched in by this import
import '@babylonjs/core/Animations/animatable'
import { Plane } from '@babylonjs/core/Maths/math.plane'
import ViewBox, { ViewBoxDirection } from './Renderables/viewbox'
import Bed, { BuildVolume, RenderBedMode } from './Renderables/bed'
import Axes from './Renderables/axes'
import Ruler from './Renderables/ruler'
import Workplace from './Renderables/workplace'
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
   ruler: Ruler | null = null
   workplace: Workplace | null = null
   buildObjects: BuildObjects | null = null
   zTopClipValue: number | null = null
   zBottomClipValue: number | null = null
   // When false, clicking a rendered line no longer seeks the file position. The live job view turns
   // this off so the print head can't be scrubbed away from where the printer actually is
   allowSeek: boolean = true
   // Mirrored from the render materials: with both off, not-yet-printed geometry is discarded, so
   // the camera framing has to stop at the current file position instead of the whole file
   private alphaMode = false
   private progressMode = false
   offscreen: boolean = true
   // Animation runs at a nominal 60 fps, so this is a half-second transition
   private static readonly CAMERA_TRANSITION_FRAMES = 30
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

      this.ruler = new Ruler(this.scene)
      this.ruler.registerClipIgnore = (mesh) => {
         this.registerClipIgnore(mesh)
      }
      this.ruler.color = this.bed.getBedColor()
      this.ruler.build(this.bed.buildVolume)

      this.workplace = new Workplace(this.scene)
      this.workplace.registerClipIgnore = (mesh) => {
         this.registerClipIgnore(mesh)
      }

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
                  this.resetCamera(true)
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
         if (pointerInfo.type == PointerEventTypes.POINTERMOVE) {
            this.viewBox?.updateHover(this.scene.pointerX, this.scene.pointerY)
         }
         if (pointerInfo.type == PointerEventTypes.POINTERDOWN) {
            // Grabbing the camera mid-transition would otherwise fight the animation for every frame
            this.stopCameraAnimation()
         }
      })

      //this.loadInstrumentation()

      // The scene, bed, axes, camera and build-object machinery are all created above in this async
      // method. Signal the main thread that configuration messages (build volume, bed, tools,
      // camera) can now be applied without racing an undefined scene
      this.worker.postMessage({ type: 'ready' })
   }

   // Assigning target normally rebuilds alpha/beta/radius from the camera position, which would undo
   // the angle animations on every frame, so the override stays on for as long as one is running
   private stopCameraAnimation() {
      if (this.orbitCamera) {
         this.scene?.stopAnimation(this.orbitCamera)
         this.orbitCamera.overrideCloneAlphaBetaRadius = null
      }
   }

   // Orbits to the new framing rather than cutting to it, so it stays readable which way the model turned
   private animateCameraTo(alpha: number, beta: number, radius: number, target: Vector3) {
      if (!this.orbitCamera || !this.scene) {
         return
      }
      // Unwrap onto the camera's current revolution, otherwise crossing the +/-PI seam goes the long way round
      const shortestAlpha = alpha + Math.round((this.orbitCamera.alpha - alpha) / (2 * Math.PI)) * 2 * Math.PI

      const ease = new CubicEase()
      ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT)
      this.stopCameraAnimation()
      this.orbitCamera.overrideCloneAlphaBetaRadius = true
      Animation.CreateAndStartAnimation('cameraAlpha', this.orbitCamera, 'alpha', 60, Viewer.CAMERA_TRANSITION_FRAMES, this.orbitCamera.alpha, shortestAlpha, Animation.ANIMATIONLOOPMODE_CONSTANT, ease)
      Animation.CreateAndStartAnimation('cameraBeta', this.orbitCamera, 'beta', 60, Viewer.CAMERA_TRANSITION_FRAMES, this.orbitCamera.beta, beta, Animation.ANIMATIONLOOPMODE_CONSTANT, ease)
      Animation.CreateAndStartAnimation('cameraRadius', this.orbitCamera, 'radius', 60, Viewer.CAMERA_TRANSITION_FRAMES, this.orbitCamera.radius, radius, Animation.ANIMATIONLOOPMODE_CONSTANT, ease)
      Animation.CreateAndStartAnimation('cameraTarget', this.orbitCamera, 'target', 60, Viewer.CAMERA_TRANSITION_FRAMES, this.orbitCamera.target.clone(), target, Animation.ANIMATIONLOOPMODE_CONSTANT, ease, () => this.stopCameraAnimation())
   }

   // Move the orbit camera so it views the bed from the given direction (viewbox face/edge/corner metadata)
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

      // Let the camera resolve the spherical coordinates for the requested position, then rewind it
      // and animate there - deriving alpha/beta by hand would duplicate what setPosition already does
      const fromAlpha = this.orbitCamera.alpha, fromBeta = this.orbitCamera.beta, fromRadius = this.orbitCamera.radius
      const fromTarget = this.orbitCamera.target.clone()
      this.orbitCamera.setTarget(target)
      this.orbitCamera.setPosition(target.subtract(look.scale(distance)))
      if (direction.x === 0 && direction.z === 0) {
         this.orbitCamera.alpha = (3 * Math.PI) / 2
      }
      const toAlpha = this.orbitCamera.alpha, toBeta = this.orbitCamera.beta, toRadius = this.orbitCamera.radius
      // Target first: setTarget rebuilds the angles from the position, so it has to run before they are restored
      this.orbitCamera.setTarget(fromTarget)
      this.orbitCamera.alpha = fromAlpha
      this.orbitCamera.beta = fromBeta
      this.orbitCamera.radius = fromRadius

      this.animateCameraTo(toAlpha, toBeta, toRadius, target)
   }

   // Default framing: the whole bed plus whatever is loaded on it, so nothing sticks out of frame
   resetCamera(animate = false) {
      if (!this.orbitCamera || !this.bed) {
         return
      }
      this.frameCorners(this.bedCorners().concat(this.printCorners()), animate)
   }

   // Framed to the printed geometry rather than the whole bed (used by the embedded job view); falls
   // back to bed framing when nothing is loaded yet
   frameToPrint(animate = false) {
      const corners = this.printCorners()
      if (corners.length === 0) {
         this.resetCamera(animate)
         return
      }
      this.frameCorners(corners, animate)
   }

   // Bed footprint corners on the plate, in Babylon space (x = G-code X, y = height, z = G-code Y)
   private bedCorners(): Vector3[] {
      if (!this.bed) {
         return []
      }
      const center = this.bed.getCenter()
      const size = this.bed.getSize()
      const hx = size.x / 2, hy = size.y / 2
      return [
         new Vector3(center.x - hx, 0, center.y - hy), new Vector3(center.x + hx, 0, center.y - hy),
         new Vector3(center.x - hx, 0, center.y + hy), new Vector3(center.x + hx, 0, center.y + hy),
      ]
   }

   // The eight corners of the loaded print's bounding box, empty when nothing extruding has been
   // parsed. With unprinted geometry hidden only what has printed so far is on screen, so that is
   // all the framing may count
   private printCorners(): Vector3[] {
      const bounds = this.processor.getExtrusionBounds(this.alphaMode || this.progressMode ? undefined : this.processor.renderedFilePosition)
      if (!bounds) {
         return []
      }
      const lo = bounds.min, hi = bounds.max
      return [
         new Vector3(lo.x, lo.y, lo.z), new Vector3(hi.x, lo.y, lo.z), new Vector3(lo.x, lo.y, hi.z), new Vector3(hi.x, lo.y, hi.z),
         new Vector3(lo.x, hi.y, lo.z), new Vector3(hi.x, hi.y, lo.z), new Vector3(lo.x, hi.y, hi.z), new Vector3(hi.x, hi.y, hi.z),
      ]
   }

   // Front view tilted 45 deg down (alpha -PI/2 faces the front edge, beta PI/4 is the tilt), pulled
   // back until the given world-space corners fit the viewport
   private frameCorners(corners: Vector3[], animate: boolean) {
      const camera = this.orbitCamera
      if (!camera || !this.engine || corners.length === 0) {
         return
      }
      let min = corners[0], max = corners[0]
      for (const corner of corners) {
         min = Vector3.Minimize(min, corner)
         max = Vector3.Maximize(max, corner)
      }
      const fromAlpha = camera.alpha, fromBeta = camera.beta, fromRadius = camera.radius
      const fromTarget = camera.target.clone()

      this.stopCameraAnimation()
      camera.target = min.add(max).scale(0.5)
      camera.alpha = -Math.PI / 2
      camera.beta = Math.PI / 4
      // Start far enough back that every corner is in front of the camera on the first fitting pass
      camera.radius = 2 * Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1)
      // Before the canvas has a real size the projection matrix is degenerate; that rough radius has
      // to do until the next call, after layout or a file load, can fit properly
      if (this.engine.getRenderWidth() >= 1 && this.engine.getRenderHeight() >= 1) {
         this.fitRadius(camera, corners)
         this.centerVertically(camera, corners)
      }

      if (animate) {
         const toRadius = camera.radius, toTarget = camera.target.clone()
         camera.target = fromTarget
         camera.alpha = fromAlpha
         camera.beta = fromBeta
         camera.radius = fromRadius
         this.animateCameraTo(-Math.PI / 2, Math.PI / 4, toRadius, toTarget)
         return
      }
      this.scene?.render(true)
   }

   // Corner extents in normalized device coordinates, where the visible range is [-1, 1] on each
   // axis. Null when a corner sits behind the camera, which projection would flip across the frame
   private projectCorners(camera: ArcRotateCamera, corners: Vector3[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
      const transform = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true))
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const corner of corners) {
         const clip = Vector4.TransformCoordinates(corner, transform)
         if (clip.w <= 0) {
            return null
         }
         minX = Math.min(minX, clip.x / clip.w)
         maxX = Math.max(maxX, clip.x / clip.w)
         minY = Math.min(minY, clip.y / clip.w)
         maxY = Math.max(maxY, clip.y / clip.w)
      }
      return { minX, maxX, minY, maxY }
   }

   // Rescale the orbit radius by however much of the clip volume the corners span, so the fit follows
   // the box size, the camera tilt and the viewport aspect ratio. Perspective makes a single pass
   // approximate, hence the converging loop
   private fitRadius(camera: ArcRotateCamera, corners: Vector3[]) {
      for (let pass = 0; pass < 8; pass++) {
         const ndc = this.projectCorners(camera, corners)
         if (!ndc) {
            camera.radius *= 2
            continue
         }
         // Fill 95% of the viewport width or 74% of its height, whichever binds first - the rest
         // stays as breathing room, the taller share of it below for the playback controls
         const fill = Math.max((ndc.maxX - ndc.minX) / 2 / 0.95, (ndc.maxY - ndc.minY) / 2 / 0.74)
         if (fill <= 0) {
            break
         }
         const radius = camera.radius * fill
         const converged = Math.abs(radius - camera.radius) < camera.radius * 0.01
         camera.radius = radius
         if (converged) {
            break
         }
      }
   }

   // Centre the corners between the top of the playback controls and the top of the viewport, whose
   // midpoint is clip space y +0.1. Perspective skews the projected box, so the look-at point is
   // nudged until the centre lands; damped empirical steps converge without knowing the FOV
   private centerVertically(camera: ArcRotateCamera, corners: Vector3[]) {
      for (let pass = 0; pass < 6; pass++) {
         const ndc = this.projectCorners(camera, corners)
         if (!ndc) {
            break
         }
         const delta = 0.1 - (ndc.minY + ndc.maxY) / 2
         if (Math.abs(delta) < 0.01) {
            break
         }
         // Lowering the target lifts the scene; ~0.6 radius per NDC unit lands close and the loop mops up the rest
         camera.target = new Vector3(camera.target.x, camera.target.y - delta * 0.6 * camera.radius, camera.target.z)
      }
   }

   // World-space bounding box of the rendered geometry, unioned across the meshes' thin instances.
   // Covers travels and the full extrusion width, which the clip planes have to clear
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
      this.processor.allowSeek = enabled
      if (!enabled) {
         // Drop whatever the pointer highlighted before; no real pick colour is negative
         this.processor.modelMaterial.forEach((m) => m.setPickColor([-1, -1, -1]))
      }
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
         this.ruler?.build(volume)
         // Set the spacing before commitBedSize so the grid is rebuilt once, not twice
         this.bed.setGridMajorSpacing(this.ruler?.visible ? this.ruler.tickInterval : null)
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
      if (this.bed && this.ruler) {
         this.ruler.color = this.bed.getBedColor()
         this.ruler.build(this.bed.buildVolume)
      }
   }

   // Show not-yet-printed geometry in its own colours, faded to the opacity value
   setAlphaMode(mode: boolean) {
      this.alphaMode = mode
      this.processor.modelMaterial.forEach((m) => m.setAlphaMode(mode))
   }

   // Show not-yet-printed geometry in the progress colour instead
   setProgressMode(mode: boolean) {
      this.progressMode = mode
      this.processor.modelMaterial.forEach((m) => m.setProgressMode(mode))
   }

   // Colour used for not-yet-printed geometry in progress mode (hex string, e.g. "#FFFFFFFF")
   setProgressColor(color: string) {
      const c = Color4.FromHexString(color.padEnd(9, 'F'))
      this.processor.modelMaterial.forEach((m) => m.setProgressColor([c.r * 255, c.g * 255, c.b * 255, c.a * 255]))
   }

   // Whether file positions are being fed from a running job. Off, position changes are treated as
   // seeks and paint no trail
   setLiveTracking(enabled: boolean) {
      this.processor.setLiveTracking(enabled)
   }

   // Seconds a freshly printed segment takes to fade from red through yellow to its own colour. Zero
   // disables the fade
   setTrailDuration(seconds: number) {
      this.processor.setTrailDuration(seconds)
   }

   // Colour a freshly printed segment starts at before fading to its own colour (hex string)
   setTrailColor(color: string) {
      const c = Color4.FromHexString(color.padEnd(9, 'F'))
      this.processor.setTrailColor([c.r * 255, c.g * 255, c.b * 255])
   }

   // Opacity (0-1) of not-yet-printed geometry while alpha mode is on
   setUnprintedOpacity(value: number) {
      this.processor.modelMaterial.forEach((m) => m.setUnprintedOpacity(value))
   }

   // Show/hide the printed travel (non-extruding) moves
   setShowTravels(show: boolean) {
      this.processor.modelMaterial.forEach((m) => m.setShowTravels(show))
   }

   // Keep printed travels on screen instead of discarding them once the flash has passed
   setPersistTravels(persist: boolean) {
      this.processor.modelMaterial.forEach((m) => m.setPersistTravels(persist))
   }

   // Feed rate gradient endpoints in mm/min; null restores the range measured while parsing
   setFeedRateRange(min: number | null, max: number | null) {
      this.processor.setFeedRateRange(min, max)
   }

   // Colours the feed rate render mode interpolates between (hex strings)
   setFeedRateColors(minColor: string, maxColor: string) {
      const min = Color4.FromHexString(minColor.padEnd(9, 'F'))
      const max = Color4.FromHexString(maxColor.padEnd(9, 'F'))
      this.processor.modelMaterial.forEach((m) => m.setMinFeedColor([min.r * 255, min.g * 255, min.b * 255]))
      this.processor.modelMaterial.forEach((m) => m.setMaxFeedColor([max.r * 255, max.g * 255, max.b * 255]))
   }

   // Specular highlights on the extrusion geometry; the line mesh variant ignores it
   setSpecular(enabled: boolean) {
      this.processor.modelMaterial.forEach((m) => m.setSpecular(enabled))
   }

   // Absolute nozzle marker position in G-code coordinates, for following a live job
   setNozzlePosition(x: number, y: number, z: number, animate: boolean) {
      this.processor.setNozzlePosition(x, y, z, animate)
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

   // Tick labels along the front and left bed edges
   showRuler(visible: boolean) {
      this.ruler?.show(visible)
      this.syncGridToRuler()
   }

   // Tick spacing in mm, null to size it from the bed
   setRulerInterval(interval: number | null) {
      this.ruler?.setInterval(interval)
      this.syncGridToRuler()
   }

   private syncGridToRuler() {
      this.bed?.setGridMajorSpacing(this.ruler?.visible ? this.ruler.tickInterval : null)
      this.scene?.render(true)
   }

   // Origin markers for the workplaces the file shifts into. Only ones with a non-zero offset are
   // drawn, so a file that never touches G10 L2/L20 shows nothing
   showWorkplace(visible: boolean) {
      this.workplace?.show(visible)
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
      // Workplace offsets are only known once the file has been parsed
      this.workplace?.render(this.processor.processorProperties.workplaceOffsets)
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
