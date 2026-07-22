import ViewerWorker from './viewer.worker?worker&inline'

const mouseEventFields = [
   'altKey',
   'bubbles',
   'button',
   'buttons',
   'cancelBubble',
   'cancelable',
   'clientX',
   'clientY',
   'composed',
   'ctrlKey',
   'defaultPrevented',
   'detail',
   'eventPhase',
   'fromElement',
   'isTrusted',
   'layerX',
   'layerY',
   'metaKey',
   'movementX',
   'movementY',
   'offsetX',
   'offsetY',
   'pageX',
   'pageY',
   'returnValue',
   'screenX',
   'screenY',
   'shiftKey',
   'timeStamp',
   'type',
   'which',
   'x',
   'y',
   'deltaX',
   'deltaY',
   'deltaZ',
   'deltaMode',
]

const keyboardEventFields = [
   'isTrusted',
   'altKey',
   'bubbles',
   'cancelBubble',
   'cancelable',
   'charCode',
   'code',
   'composed',
   'ctrlKey',
   'defaultPrevented',
   'detail',
   'eventPhase',
   'isComposing',
   'key',
   'keyCode',
   'location',
   'metaKey',
   'repeat',
   'returnValue',
   'shiftKey',
   'type',
   'which',
]

export default class ViewerProxy {
   private webWorker: Worker
   mainCanvas: HTMLCanvasElement | null = null
   // Every DOM listener we install on the worker's behalf, so unload() can detach them all. Without
   // this they leak on every mount/unmount and keep posting into a terminated worker
   private registeredListeners: Array<{ target: EventTarget; eventName: string; handler: EventListener; opt: any }> = []
   private unloadFallback: ReturnType<typeof setTimeout> | null = null
   private suspended = false

   constructor(canvas: HTMLCanvasElement) {
      this.mainCanvas = canvas
      this.webWorker = new ViewerWorker()
      this.webWorker.onmessage = (e) => {
         this.onmessage(e)
      }
      this.webWorker.onerror = (e) => {
         this.onerror(e)
      }

      const offscreen = this.mainCanvas?.transferControlToOffscreen()
      this.webWorker.postMessage(
         {
            type: 'init',
            width: this.mainCanvas.clientWidth,
            height: this.mainCanvas.clientHeight,
            offscreencanvas: offscreen,
         },
         [offscreen],
      )

      // Forward window resizes to the worker without the host having to wire it up. Tracked like any
      // other listener so it's removed on unload rather than clobbering window.onresize
      this.addTrackedListener(window, 'resize', () => {
         this.webWorker.postMessage({
            type: 'resize',
            width: this.mainCanvas?.clientWidth,
            height: this.mainCanvas?.clientHeight,
         })
      })

      // The worker's faked document cannot observe tab visibility, so mirror it over to pause the
      // render loop while the tab is hidden
      this.addTrackedListener(document, 'visibilitychange', () => {
         this.webWorker.postMessage({ type: 'visibility', hidden: this.suspended || document.hidden })
      })
   }

   private addTrackedListener(target: EventTarget, eventName: string, handler: EventListener, opt?: any) {
      target.addEventListener(eventName, handler, opt)
      this.registeredListeners.push({ target, eventName, handler, opt })
   }

   //Messages from the worker
   private onmessage(e: any) {
      if (!e.data.type) return //discard
      switch (e.data.type) {
         case 'event':
            {
               //event registration
               let target
               switch (e.data.targetName) {
                  case 'window':
                     target = window
                     break
                  case 'canvas':
                     target = this.mainCanvas
                     break
                  case 'document':
                     target = document
                     break
               }

               if (!target) {
                  console.error('Unknown target: ' + e.data.targetName)
                  return
               }

               //console.log('Registering event ' + e.data.eventName + ' on ' + e.data.targetName)

               this.addTrackedListener(
                  target,
                  e.data.eventName,
                  (evt) => {
                     // We can`t pass original event to the worker
                     let eventClone = {}
                     try {
                        eventClone = this.cloneEvent(evt)
                     } catch (e) {
                        console.log('Error cloning event', e)
                     }
                     evt.stopPropagation()
                     evt.preventDefault()

                     // Babylon derives pointerX/Y as clientX/Y minus the canvas rect. The worker's
                     // faked canvas reports a rect at the origin, so translate mouse coords to
                     // canvas-relative here using the live rect - correct under scroll/layout shifts,
                     // which a cached rect on the worker side would miss (the page scrolls after load)
                     if (e.data.targetName === 'canvas' && this.mainCanvas && typeof (eventClone as any).clientX === 'number') {
                        const rect = this.mainCanvas.getBoundingClientRect()
                        ;(eventClone as any).clientX -= rect.left
                        ;(eventClone as any).clientY -= rect.top
                     }

                     this.webWorker.postMessage({
                        type: 'event',
                        targetName: e.data.targetName,
                        eventName: e.data.eventName,
                        eventClone: eventClone,
                     })
                     return false
                  },
                  e.data.opt,
               )
            }
            break
         case 'canvasMethod': //Calls from the canvas to preform functions such as focus
            if (this.mainCanvas) {
               this.mainCanvas[e.data.method](...e.data.args)
            }
            break
         case 'unloadComplete':
            if (this.unloadFallback) {
               clearTimeout(this.unloadFallback)
               this.unloadFallback = null
            }
            this.removeAllListeners()
            this.webWorker.terminate()
            break
         //case 'currentline':
         //case 'fileloaded':
         //case 'positionupdate':
         default: {
            if (this.passThru) {
               this.passThru(e.data)
            }
         }
      }
   }

   passThru: any = null

   private onerror(e: any) {
      console.log('Error received from worker')
      console.log(e)
   }

   init(): void {}

   cancel(): void {
      this.webWorker.postMessage({ type: 'cancel', params: [] })
   }

   loadFile(file): void {
      this.webWorker.postMessage({ type: 'loadFile', file: file })
   }

   // Host-driven pause for kept-alive components: shares the worker's tab-visibility gate, so the
   // render loop stops while the component is deactivated and the two states cannot fight each other
   suspend(suspended: boolean): void {
      this.suspended = suspended
      this.webWorker.postMessage({ type: 'visibility', hidden: this.suspended || document.hidden })
   }

   unload(): void {
      this.removeAllListeners()
      this.webWorker.postMessage({ type: 'unload', params: [] })
      // If the worker never confirms the unload (e.g. an exception during engine teardown), kill it
      // anyway - a leaked worker keeps rendering its detached OffscreenCanvas indefinitely
      this.unloadFallback = setTimeout(() => this.webWorker.terminate(), 2000)
   }

   reset(): void {
      this.webWorker.postMessage({ type: 'reset', params: [] })
   }

   updateFilePosition(filePosition: number, animate: boolean = false): void {
      this.webWorker.postMessage({ type: 'updatefileposition', position: filePosition, animate: animate })
   }

   setRenderMode(mode: number): void {
      this.webWorker.postMessage({ type: 'rendermode', mode: mode })
   }

   getGCodes(position: number, count: number): void {
      this.webWorker.postMessage({ type: 'getgcodes', position: position, count: count })
   }

   goToLineNumber(lineNumber: number): void {
      this.webWorker.postMessage({ type: 'gotolinenumber', lineNumber: lineNumber })
   }

   setAlphaMode(mode: boolean): void {
      this.webWorker.postMessage({ type: 'setalphamode', mode: mode })
   }

   setProgressMode(mode: boolean): void {
      this.webWorker.postMessage({ type: 'setprogressmode', mode: mode })
   }

   setMeshMode(mode: number): void {
      this.webWorker.postMessage({ type: 'setmeshmode', mode: mode })
   }

   setMaxFPS(fps: number): void {
      this.webWorker.postMessage({ type: 'setfps', fps: fps })
   }

   setPerimeterOnly(perimeterOnly: boolean): void {
      this.webWorker.postMessage({ type: 'perimeterOnly', perimeterOnly: perimeterOnly })
   }

   toggleNozzle(visible: boolean): void {
      this.webWorker.postMessage({ type: 'toggleNozzle', visible: visible })
   }

   startNozzleAnimation(): void {
      this.webWorker.postMessage({ type: 'startNozzleAnimation' })
   }

   pauseNozzleAnimation(): void {
      this.webWorker.postMessage({ type: 'pauseNozzleAnimation' })
   }

   resumeNozzleAnimation(): void {
      this.webWorker.postMessage({ type: 'resumeNozzleAnimation' })
   }

   stopNozzleAnimation(): void {
      this.webWorker.postMessage({ type: 'stopNozzleAnimation' })
   }

   // Enable/disable click-to-seek on rendered lines. The live job view disables it so the print head
   // can't be scrubbed away from the printer's actual position
   setAllowSeek(enabled: boolean): void {
      this.webWorker.postMessage({ type: 'setAllowSeek', enabled: enabled })
   }

   showViewBox(visible: boolean): void {
      this.webWorker.postMessage({ type: 'showViewBox', visible: visible })
   }

   setCameraDirection(direction: { x: number; y: number; z: number }): void {
      this.webWorker.postMessage({ type: 'setCameraDirection', direction: direction })
   }

   // What resetCamera frames; leaving or returning to it arrives as a `cameradefault` event
   setDefaultFraming(mode: 'bed' | 'print'): void {
      this.webWorker.postMessage({ type: 'setDefaultFraming', mode: mode })
   }

   // Animating is for an explicit user action; load-time framing should just snap into place
   resetCamera(animate = false): void {
      this.webWorker.postMessage({ type: 'resetCamera', animate: animate })
   }

   // Ask the worker to report the print's Z extent; arrives as a `printbounds` event via passThru
   requestPrintBounds(): void {
      this.webWorker.postMessage({ type: 'requestPrintBounds' })
   }

   setBackgroundColor(color: string): void {
      this.webWorker.postMessage({ type: 'setBackgroundColor', color: color })
   }

   setCameraInertia(enabled: boolean): void {
      this.webWorker.postMessage({ type: 'setCameraInertia', enabled: enabled })
   }

   setZClipPlane(top: number, bottom: number): void {
      this.webWorker.postMessage({ type: 'setZClipPlane', top: top, bottom: bottom })
   }

   setTools(tools: { color: string; diameter?: number }[]): void {
      this.webWorker.postMessage({ type: 'setTools', tools: tools })
   }

   setBuildVolume(volume: { x: { min: number; max: number }; y: { min: number; max: number }; z: { min: number; max: number } }): void {
      this.webWorker.postMessage({ type: 'setBuildVolume', volume: volume })
   }

   setBedRenderMode(mode: number): void {
      this.webWorker.postMessage({ type: 'setBedRenderMode', mode: mode })
   }

   setBedColor(color: string): void {
      this.webWorker.postMessage({ type: 'setBedColor', color: color })
   }

   setProgressColor(color: string): void {
      this.webWorker.postMessage({ type: 'setProgressColor', color: color })
   }

   setLiveTracking(enabled: boolean): void {
      this.webWorker.postMessage({ type: 'setLiveTracking', enabled: enabled })
   }

   setTrailDuration(seconds: number): void {
      this.webWorker.postMessage({ type: 'setTrailDuration', seconds: seconds })
   }

   setTrailColor(color: string): void {
      this.webWorker.postMessage({ type: 'setTrailColor', color: color })
   }

   setUnprintedOpacity(value: number): void {
      this.webWorker.postMessage({ type: 'setUnprintedOpacity', value: value })
   }

   setShowTravels(show: boolean): void {
      this.webWorker.postMessage({ type: 'setShowTravels', show: show })
   }

   // Keep travels visible after they have been printed instead of discarding them past the flash
   setPersistTravels(persist: boolean): void {
      this.webWorker.postMessage({ type: 'setPersistTravels', persist: persist })
   }

   // Feed rate gradient endpoints, in mm/min. Both default to the range measured while parsing
   setFeedRateRange(min: number, max: number): void {
      this.webWorker.postMessage({ type: 'setFeedRateRange', min: min, max: max })
   }

   // Colours the feed rate render mode interpolates between (hex strings)
   setFeedRateColors(minColor: string, maxColor: string): void {
      this.webWorker.postMessage({ type: 'setFeedRateColors', minColor: minColor, maxColor: maxColor })
   }

   setSpecular(enabled: boolean): void {
      this.webWorker.postMessage({ type: 'setSpecular', enabled: enabled })
   }

   // Absolute nozzle marker position in G-code coordinates; the axis swap happens in the worker
   setNozzlePosition(x: number, y: number, z: number, animate: boolean = false): void {
      this.webWorker.postMessage({ type: 'setNozzlePosition', x: x, y: y, z: z, animate: animate })
   }

   // Parse-time flags: the caller has to reload the file for any of these to take effect
   // Extrusion width for high quality rendering: an explicit override beats the value the slicer
   // wrote into the file, which beats the caller's own guess. null drops a step
   setNozzleDiameter(override: number | null, fallback: number | null): void {
      this.webWorker.postMessage({ type: 'setNozzleDiameter', override: override, fallback: fallback })
   }

   setHQRendering(enabled: boolean): void {
      this.webWorker.postMessage({ type: 'setHQRendering', enabled: enabled })
   }

   setG1AsExtrusion(enabled: boolean): void {
      this.webWorker.postMessage({ type: 'setG1AsExtrusion', enabled: enabled })
   }

   setZBelt(enabled: boolean, gantryAngle: number): void {
      this.webWorker.postMessage({ type: 'setZBelt', enabled: enabled, gantryAngle: gantryAngle })
   }

   setAnimationSpeed(speed: number): void {
      this.webWorker.postMessage({ type: 'setAnimationSpeed', speed: speed })
   }

   setDeltaBed(isDelta: boolean): void {
      this.webWorker.postMessage({ type: 'setDeltaBed', isDelta: isDelta })
   }

   showBed(visible: boolean): void {
      this.webWorker.postMessage({ type: 'showBed', visible: visible })
   }

   showAxes(visible: boolean): void {
      this.webWorker.postMessage({ type: 'showAxes', visible: visible })
   }

   // Tick labels along the front and left bed edges
   showRuler(visible: boolean): void {
      this.webWorker.postMessage({ type: 'showRuler', visible: visible })
   }

   // Tick spacing in mm, null to size it from the bed
   setRulerInterval(interval: number | null): void {
      this.webWorker.postMessage({ type: 'setRulerInterval', interval: interval })
   }


   // Origin markers for workplaces the file shifts into with G10 L2/L20
   showWorkplace(visible: boolean): void {
      this.webWorker.postMessage({ type: 'showWorkplace', visible: visible })
   }

   // Boundary data from the printer object model; objectSelected/objectLabel events arrive via passThru
   loadObjectBoundaries(objects: any[]): void {
      this.webWorker.postMessage({ type: 'loadObjectBoundaries', objects: objects })
   }

   showObjectSelection(visible: boolean): void {
      this.webWorker.postMessage({ type: 'showObjectSelection', visible: visible })
   }

   showObjectLabels(visible: boolean): void {
      this.webWorker.postMessage({ type: 'showObjectLabels', visible: visible })
   }

   enableWasmProcessing(): Promise<void> {
      return new Promise((resolve, reject) => {
         // Resolve on the worker's reply, but also reject if the worker itself dies (no OffscreenCanvas,
         // CSP blocking wasm-eval, etc). Otherwise this promise would hang forever and the host awaits it
         const cleanup = () => {
            this.webWorker.removeEventListener('message', handleWasmInit)
            this.webWorker.removeEventListener('error', handleWorkerError)
         }
         const handleWasmInit = (e: MessageEvent) => {
            if (e.data.type === 'wasmInitialized') {
               cleanup()
               if (e.data.success) {
                  resolve()
               } else {
                  reject(new Error(e.data.error || 'WASM initialization failed'))
               }
            }
         }
         const handleWorkerError = (e: ErrorEvent) => {
            cleanup()
            reject(new Error(e.message || 'Viewer worker crashed during WASM initialization'))
         }

         this.webWorker.addEventListener('message', handleWasmInit)
         this.webWorker.addEventListener('error', handleWorkerError)
         this.webWorker.postMessage({ type: 'enableWasmProcessing' })
      })
   }

   getProcessingStats(): Promise<any> {
      return new Promise((resolve) => {
         // Set up one-time message handler for processing stats
         const handleStats = (e: MessageEvent) => {
            if (e.data.type === 'processingStatsResponse') {
               this.webWorker.removeEventListener('message', handleStats)
               resolve(e.data.stats)
            }
         }
         
         this.webWorker.addEventListener('message', handleStats)
         this.webWorker.postMessage({ type: 'getProcessingStats' })
      })
   }

   private removeAllListeners() {
      for (const { target, eventName, handler, opt } of this.registeredListeners) {
         target.removeEventListener(eventName, handler, opt)
      }
      this.registeredListeners = []
   }

   //Used to clone the event properties out of an object so they can be sent to worker
   cloneEvent(event) {
      const cloneFieldList = event.constructor.name === 'KeyboardEvent' ? keyboardEventFields : mouseEventFields
      const cloneFields = {}
      for (const field of cloneFieldList) {
         cloneFields[field] = event[field]
      }
      return cloneFields
   }
}
