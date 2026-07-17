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

   unload(): void {
      this.webWorker.postMessage({ type: 'unload', params: [] })
   }

   reset(): void {
      this.webWorker.postMessage({ type: 'reset', params: [] })
   }

   updateColorTest(): void {
      this.webWorker.postMessage({ type: 'updatecolortest', params: [] })
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

   resetCamera(): void {
      this.webWorker.postMessage({ type: 'resetCamera' })
   }

   // Frame the loaded print (rather than the whole bed) with the default front-45 orientation
   frameToPrint(): void {
      this.webWorker.postMessage({ type: 'frameToPrint' })
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

   setTransparencyValue(value: number): void {
      this.webWorker.postMessage({ type: 'setTransparencyValue', value: value })
   }

   setShowTravels(show: boolean): void {
      this.webWorker.postMessage({ type: 'setShowTravels', show: show })
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
