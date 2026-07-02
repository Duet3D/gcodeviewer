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

      //Handle window resize events without user having to implement
      window.onresize = () => {
         this.webWorker.postMessage({
            type: 'resize',
            width: this.mainCanvas?.clientWidth,
            height: this.mainCanvas?.clientHeight,
         })
      }
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

               target.addEventListener(
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

   showViewBox(visible: boolean): void {
      this.webWorker.postMessage({ type: 'showViewBox', visible: visible })
   }

   setCameraDirection(direction: { x: number; y: number; z: number }): void {
      this.webWorker.postMessage({ type: 'setCameraDirection', direction: direction })
   }

   resetCamera(): void {
      this.webWorker.postMessage({ type: 'resetCamera' })
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
         // Set up one-time message handler for WASM initialization result
         const handleWasmInit = (e: MessageEvent) => {
            if (e.data.type === 'wasmInitialized') {
               this.webWorker.removeEventListener('message', handleWasmInit)
               if (e.data.success) {
                  resolve()
               } else {
                  reject(new Error(e.data.error || 'WASM initialization failed'))
               }
            }
         }
         
         this.webWorker.addEventListener('message', handleWasmInit)
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
