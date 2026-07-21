import { Base, Move, ArcMove, Move_Thin } from './GCodeLines'
import ProcessorProperties, { DEFAULT_LAYER_HEIGHT } from './processorproperties'
import { ProcessLine } from './GCodeCommands/processline'
import { Scene } from '@babylonjs/core/scene'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Axis, Space } from '@babylonjs/core/Maths/math.axis'
import Tool from './tools'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import GPUPicker from './gpupicker'
import { colorToNum, binarySearchClosest } from './util'
import { MoveData } from './GCodeLines/move'
import { slicerFactory } from './GCodeParsers/slicerfactory'
import LineShaderMaterial from './lineshader'
import Nozzle from './Renderables/nozzle'
import { WasmProcessor, WasmRenderBuffers } from './wasmprocessor'

// Extrusion width used unless high quality rendering supplies the real tool diameter
const DEFAULT_NOZZLE_SIZE = 0.4

// How much of each end of the file is searched for the slicer's nozzle diameter setting
const HEADER_SCAN_BYTES = 65536

export default class Processor {
   gCodeLines: Base[] = []
   processorProperties: ProcessorProperties = new ProcessorProperties()
   scene: Scene
   meshes: Mesh[] = []
   breakPoint = 100000
   gpuPicker: GPUPicker
   worker: Worker
   // Starts empty so material setters (render mode, alpha, tools) called before the first file is
   // loaded are harmless no-ops rather than dereferencing undefined
   modelMaterial: LineShaderMaterial[] = []
   filePosition: number = 0
   // How much of the file is drawn as printed. Not the same as filePosition: a fresh load renders the
   // whole file while the playback position stays at the start, so animation begins from the beginning
   renderedFilePosition = 0
   focusedColorId = 0
   // Hover highlighting is the affordance for click-to-seek, so it follows the same flag
   allowSeek = true
   lastMeshMode = 0
   perimeterOnly = false
   // Feed rate gradient overrides. Null means "use the range measured while parsing"
   userMinFeedRate: number | null = null
   userMaxFeedRate: number | null = null
   // Parse-time configuration: it has to survive the ProcessorProperties rebuild that every
   // parse pass does, and changing it only takes effect on the next load
   g1AsExtrusion = false
   // Real tool diameter and measured layer height instead of the fixed defaults. Needs a reload
   hqRendering = false
   // Extrusion width resolution, highest precedence first: an explicit override, the value the
   // slicer wrote into the file, then whatever the caller could infer for itself
   nozzleDiameterOverride: number | null = null
   nozzleDiameterFallback: number | null = null
   private parsedNozzleDiameter: number | null = null
   zBelt = false
   gantryAngle = 45
   // The single retained copy of the file text; gCodeLines store only byte offsets and re-slice
   // from here via lineText()
   originalFile: string | undefined
   // Set by cancelLoad() to abort an in-progress parse at the next chunk boundary
   private cancelRequested = false
   nozzle: Nozzle | null = null
   // Track position data for nozzle animation since Move objects get replaced with Move_Thin
   positionTracker: Map<number, { x: number; y: number; z: number; feedRate: number; extruding: boolean }> = new Map()
   // Animation playback state
   private isPlaying: boolean = false
   private playbackTimeout: number | null = null
   private sortedPositions: number[] = []
   // Progress tracking optimization
   private lastReportedProgress: number = 0
   private lastReportedChunk: number = 0
   // WASM processor for fast parsing
   private wasmProcessor: WasmProcessor | null = null
   private wasmRenderBuffers: WasmRenderBuffers | null = null
   // Processing method tracking
   private lastProcessingMethod: 'typescript' | 'wasm' | 'hybrid' | 'none' = 'none'
   private processingStats: {
      method: string
      wasmEnabled: boolean
      wasmVersion?: string
      totalTime?: number
      wasmTime?: number
      typescriptTime?: number
      wasmRenderTime?: number
      linesProcessed?: number
      movesFound?: number
      positionsExtracted?: number
      renderSegmentsGenerated?: number
   } = { method: 'none', wasmEnabled: false }

   async enableWasmProcessing(): Promise<void> {
      if (!this.wasmProcessor) {
         this.wasmProcessor = new WasmProcessor()
         await this.wasmProcessor.initialize()
         this.wasmProcessor.setG1AsExtrusion(this.g1AsExtrusion)
         this.wasmProcessor.setZBelt(this.zBelt, this.gantryAngle)
         this.processingStats.wasmEnabled = true
         console.log('WASM processing enabled for G-code parsing')
      }
   }

   getProcessingMethod(): string {
      return this.lastProcessingMethod
   }

   getProcessingStats() {
      return { ...this.processingStats }
   }

   isWasmEnabled(): boolean {
      return this.wasmProcessor !== null && this.processingStats.wasmEnabled
   }

   private async getWasmVersion(): Promise<string> {
      try {
         const { get_version } = await import('../WASM_FileProcessor/pkg/gcode_file_processor')
         return get_version()
      } catch {
         return 'unknown'
      }
   }

   initNozzle(diameter: number = 0.4) {
      if (this.scene) {
         this.nozzle = new Nozzle(this.scene, diameter)
         // Set faster animation speed for simulation
         this.nozzle.setAnimationSpeed(10.0)
         console.log('Nozzle initialized and ready for animation')
      }
   }

   getNozzle(): Nozzle | null {
      return this.nozzle
   }

   lineText(l: Base): string {
      return this.originalFile?.substring(l.filePosition, l.filePosition + l.lineLength) ?? ''
   }

   // Replaces the tool table, e.g. from the printer's object model. Colors are hex strings like '#ff0000'
   setTools(toolData: { color: string; diameter?: number }[]) {
      if (!toolData || toolData.length === 0) {
         return
      }
      this.processorProperties.tools = toolData.map((tool, idx) => {
         const newTool = new Tool(idx, Color3.FromHexString(tool.color.substring(0, 7)).toColor4(1))
         if (tool.diameter) {
            newTool.diameter = tool.diameter
         }
         return newTool
      })
      this.processorProperties.currentTool = this.processorProperties.tools[0]
      this.modelMaterial.forEach((m) => m.updateToolColors(this.processorProperties.buildToolFloat32Array()))
   }

   cleanup() {
      this.gpuPicker.clearRenderList()
      for (let idx = 0; idx < this.meshes.length; idx++) {
         this.scene.removeMesh(this.meshes[idx], true)
         this.meshes[idx].dispose(false, true)
      }
      this.meshes = []
      this.modelMaterial = []

      // Release the parsed model so unloading (or loading a new file) doesn't keep the previous
      // file's line objects, position data and raw text alive
      this.gCodeLines = []
      this.positionTracker.clear()
      this.sortedPositions = []
      this.filePosition = 0
      this.renderedFilePosition = 0
      this.originalFile = undefined

      // Note: Don't dispose WASM processor here - it should persist across file loads
   }

   // Abort an in-progress loadFile at the next chunk boundary
   cancelLoad() {
      this.cancelRequested = true
   }

   private throwIfCancelled() {
      if (this.cancelRequested) {
         throw new Error('LOAD_CANCELLED')
      }
   }

   dispose() {
      // Clean up WASM processor only when processor itself is disposed
      if (this.wasmProcessor) {
         this.wasmProcessor.dispose()
         this.wasmProcessor = null
      }
   }

   async loadFile(file) {
      this.cancelRequested = false
      this.cleanup()
      // Empty download - tell the UI so it can drop the loading state instead of waiting for a
      // fileloaded that never comes. Whitespace-only files parse to zero moves and are caught below
      if (!file) {
         this.worker.postMessage({ type: 'loaderror', message: 'Empty G-code file' })
         return
      }
      this.originalFile = file
      // Buffers from a previous WASM load must not leak into this one, otherwise a TS-parsed file would render the previous file's geometry
      this.wasmRenderBuffers = null
      this.processorProperties = this.buildProcessorProperties(file)
      this.parsedNozzleDiameter = this.findNozzleDiameter(file)

      // Reset processing stats
      const startTime = performance.now()
      this.processingStats = {
         method: 'none',
         wasmEnabled: this.wasmProcessor !== null,
         wasmVersion: this.wasmProcessor ? await this.getWasmVersion() : undefined,
         linesProcessed: 0,
         movesFound: 0,
         positionsExtracted: 0,
      }

      console.log('Processing file')

      try {
         // Try WASM processing first for better performance, fallback to TypeScript
         if (this.wasmProcessor) {
            await this.loadFileWithWasm(file)
         } else {
            console.log('Using TypeScript parser (WASM not enabled)')
            this.lastProcessingMethod = 'typescript'
            this.processingStats.method = 'typescript'
            await this.loadFileStreamed(file)
         }

         // Calculate total processing time
         this.processingStats.totalTime = performance.now() - startTime

         // Send processing complete event with statistics
         this.worker.postMessage({
            type: 'processingComplete',
            stats: this.getProcessingStats(),
         })

         // Log final processing summary
         const totalLines = this.processingStats.linesProcessed || this.gCodeLines.length
         const processingSpeed = totalLines / ((this.processingStats.totalTime || 1) / 1000)
         console.info(
            `📊 Processing Complete: ${this.processingStats.method.toUpperCase()} method, ${totalLines.toLocaleString()} lines in ${(
               this.processingStats.totalTime || 0
            ).toFixed(0)}ms (${Math.round(processingSpeed).toLocaleString()} lines/sec)`,
         )

         console.info('File Loaded.... Rendering Vertices')

         this.throwIfCancelled()

         // Check if we have WASM render buffers available
         const wasmBuffers = this.wasmRenderBuffers
         if (wasmBuffers && wasmBuffers.segmentCount > 0) {
            console.log(`🚀 Using WASM render buffers directly for ${wasmBuffers.segmentCount} segments`)
            await this.buildMeshesFromWasmBuffers(wasmBuffers)
         } else {
            console.log('📦 Using traditional progressive rendering')
            await this.testRenderSceneProgressive()
         }
      } catch (error) {
         // A cancel is expected and just leaves an empty scene; anything else is a genuine failure the
         // UI needs to hear about so it can clear the loading indicator
         this.cleanup()
         if (error instanceof Error && error.message === 'LOAD_CANCELLED') {
            this.worker.postMessage({ type: 'loadcancelled' })
         } else {
            console.error('G-code load failed', error)
            this.worker.postMessage({ type: 'loaderror', message: error instanceof Error ? error.message : String(error) })
         }
         return
      }

      // A file that parsed but produced no renderable lines (only comments/temperatures) has no bounds
      if (this.gCodeLines.length === 0) {
         this.worker.postMessage({ type: 'loaderror', message: 'No renderable moves in file' })
         return
      }

      //This is driving picking
      this.gpuPicker.colorTestCallBack = (colorId) => {
         const id = colorToNum(colorId) - 1
         // The picker reads back every frame, even while the pointer rests on the same segment
         if (id === this.focusedColorId) {
            return
         }
         this.focusedColorId = id
         if (this.gCodeLines[id] && id > 0) {
            const o = this.gCodeLines[id]

            this.worker.postMessage({
               type: 'currentline',
               line: this.lineText(o),
               lineNumber: o.lineNumber,
               filePosition: o.filePosition,
            })
            if (this.allowSeek) {
               this.modelMaterial.forEach((m) => m.setPickColor(colorId))
            }
         }
      }

      // A file without extruding F commands leaves the min/max sentinels untouched; fall back to a
      // sane range so the feed-rate gradient does not divide by a negative span
      if (this.processorProperties.minFeedRate > this.processorProperties.maxFeedRate) {
         this.processorProperties.minFeedRate = 0
         this.processorProperties.maxFeedRate = 1
      }
      this.applyFeedRateRange()
      // Re-assert the perimeter-only filter on the freshly built materials (meshes always carry the
      // full geometry now, so toggling it is a cheap uniform change rather than a reparse)
      this.modelMaterial.forEach((m) => m.setPerimeterOnly(this.perimeterOnly))

      const lastPosition = this.gCodeLines[this.gCodeLines.length - 1].filePosition
      this.renderedFilePosition = lastPosition
      this.modelMaterial.forEach((m) => m.updateCurrentFilePosition(lastPosition)) //Set it to the end
      this.gpuPicker.updateCurrentPosition(lastPosition)

      // Ensure we have valid start/end values
      let startByte = this.processorProperties.firstGCodeByte
      let endByte = this.processorProperties.lastGCodeByte

      // Fallback to file bounds if no G-code lines were found
      if (startByte === 0 && endByte === 0 && this.gCodeLines.length > 0) {
         startByte = this.gCodeLines[0].filePosition
         endByte = this.gCodeLines[this.gCodeLines.length - 1].filePosition
      }

      this.worker.postMessage({
         type: 'fileloaded',
         start: startByte,
         end: endByte,
         // null when the file carried no nozzle diameter, so the consumer can tell whether its own
         // fallback is what ends up being used
         nozzleDiameter: this.parsedNozzleDiameter,
      })

      // Initialize nozzle position to start of print
      if (this.nozzle && this.positionTracker.size > 0) {
         const firstPosition = this.positionTracker.values().next().value
         if (firstPosition) {
            this.nozzle.setPosition({
               x: firstPosition.x,
               y: firstPosition.y,
               z: firstPosition.z,
            })
         }
      }

      this.setMeshMode(this.lastMeshMode)
   }

   private async loadFileStreamed(file: string) {
      const chunkSize = 10000 // Process 10k lines at a time
      let pos = 0

      // Track TypeScript processing if not already set
      if (this.lastProcessingMethod === 'none') {
         this.lastProcessingMethod = 'typescript'
         this.processingStats.method = 'typescript'
      }

      // Estimate line count for pre-allocation (average ~40 chars per line)
      const estimatedLines = Math.ceil(file.length / 40)

      this.gCodeLines = [] // Start with empty array, will grow as needed

      // Clear position tracker for new file
      this.positionTracker.clear()
      this.sortedPositions = []

      // Reset progress tracking
      this.lastReportedProgress = 0
      this.lastReportedChunk = 0

      // Pre-allocate position tracking arrays
      let estimatedMoves = Math.ceil(estimatedLines * 0.7) // ~70% of lines are moves
      let tempPositions: number[] = new Array(estimatedMoves)
      let tempPositionData: Array<{ x: number; y: number; z: number; feedRate: number; extruding: boolean }> =
         new Array(estimatedMoves)
      let positionCount = 0

      // Stream through file character by character instead of split('\n')
      const lines = this.streamLines(file)

      for (let chunkStart = 0; chunkStart < lines.length; chunkStart += chunkSize) {
         const chunkEnd = Math.min(chunkStart + chunkSize, lines.length)

         // Process chunk
         for (let idx = chunkStart; idx < chunkEnd; idx++) {
            const line = lines[idx]
            this.processorProperties.lineNumber = idx + 1 //Use one index to match file
            this.processorProperties.filePosition = pos
            pos += line.length + 1 //Account for newlines that have been stripped

            const gcodeLine = ProcessLine(this.processorProperties, line)
            this.gCodeLines.push(gcodeLine)

            // Batch store position data for nozzle tracking
            if (gcodeLine.lineType === 'L') {
               const move = gcodeLine as Move
               if (move.end && Array.isArray(move.end) && move.end.length >= 3) {
                  // Expand arrays if we exceed initial estimate
                  if (positionCount >= estimatedMoves) {
                     const newSize = Math.ceil(estimatedMoves * 1.5)
                     const newPositions = new Array(newSize)
                     const newData = new Array(newSize)

                     // Copy existing data
                     for (let i = 0; i < positionCount; i++) {
                        newPositions[i] = tempPositions[i]
                        newData[i] = tempPositionData[i]
                     }

                     tempPositions = newPositions
                     tempPositionData = newData
                     estimatedMoves = newSize
                     console.log('Expanded position arrays to', newSize, 'entries')
                  }

                  tempPositions[positionCount] = move.filePosition
                  tempPositionData[positionCount] = {
                     x: move.end[0],
                     y: move.end[1],
                     z: move.end[2],
                     feedRate: move.feedRate || 1500,
                     extruding: move.extruding,
                  }
                  positionCount++
               }
            }
         }

         // Report progress less frequently (every 2% or every 50k lines)
         const progress = chunkEnd / lines.length
         if (progress - this.lastReportedProgress >= 0.02 || chunkEnd - this.lastReportedChunk >= 50000) {
            this.worker.postMessage({
               type: 'progress',
               progress: progress,
               label: 'Processing file',
            })
            this.lastReportedProgress = progress
            this.lastReportedChunk = chunkEnd
         }

         // Yield control to prevent blocking UI
         if (chunkEnd < lines.length) {
            this.throwIfCancelled()
            await new Promise((resolve) => setTimeout(resolve, 0))
         }
      }

      this.worker.postMessage({ type: 'progress', progress: 1, label: 'Processing file' })

      // Batch transfer position data to final data structures
      console.log('Transferring', positionCount, 'positions to tracker')

      // Pre-allocate final arrays with actual count
      this.sortedPositions = new Array(positionCount)

      for (let i = 0; i < positionCount; i++) {
         const filePos = tempPositions[i]
         this.positionTracker.set(filePos, tempPositionData[i])
         this.sortedPositions[i] = filePos
      }

      // Sort positions for sequential playback (more efficient on pre-allocated array)
      this.sortedPositions.sort((a, b) => a - b)
   }

   private async loadFileWithWasm(file: string) {
      console.log('🚀 Using WASM parser for fast processing')

      try {
         const wasmStartTime = performance.now()

         // Process file with WASM for position extraction and basic analysis
         const result = await this.wasmProcessor!.processFile(file, (progress: number, label: string) => {
            this.worker.postMessage({
               type: 'progress',
               progress: progress,
               label: label ? `WASM: ${label}` : 'Processing file',
            })
         })

         const wasmEndTime = performance.now()
         this.processingStats.wasmTime = wasmEndTime - wasmStartTime

         if (!result.success) {
            console.warn('❌ WASM processing failed, falling back to TypeScript parser:', result.errorMessage)
            this.lastProcessingMethod = 'typescript'
            this.processingStats.method = 'typescript-fallback'
            await this.loadFileStreamed(file)
            return
         }

         const linesPerSecond = Math.round(result.lineCount / (result.processingTimeMs / 1000))
         console.log(
            `✅ WASM processed ${result.lineCount.toLocaleString()} lines with ${result.moveCount.toLocaleString()} moves in ${
               result.processingTimeMs
            }ms (${linesPerSecond.toLocaleString()} lines/sec)`,
         )

         // Update processing statistics
         this.processingStats.linesProcessed = result.lineCount
         this.processingStats.movesFound = result.moveCount
         this.lastProcessingMethod = 'hybrid'
         this.processingStats.method = 'hybrid'

         // One packed buffer instead of one boundary call (and one boxed wasm object) per move
         const positionBuffer = this.wasmProcessor!.getPositionBuffer()
         const positionCount = positionBuffer.length / 6
         this.positionTracker.clear()
         this.sortedPositions = new Array(positionCount)
         for (let i = 0; i < positionCount; i++) {
            const o = i * 6
            const pos = positionBuffer[o]
            this.sortedPositions[i] = pos
            this.positionTracker.set(pos, {
               x: positionBuffer[o + 1],
               y: positionBuffer[o + 2],
               z: positionBuffer[o + 3],
               feedRate: positionBuffer[o + 4],
               extruding: positionBuffer[o + 5] !== 0,
            })
         }
         this.processingStats.positionsExtracted = positionCount

         // Generate render buffers using WASM for maximum speed
         console.log('🚀 Generating render buffers with WASM...')

         try {
            const wasmRenderBuffers = this.wasmProcessor!.generateRenderBuffers(this.extrusionWidth(), 0, this.hqRendering, (progress: number, label: string) => {
               this.worker.postMessage({
                  type: 'progress',
                  progress: progress,
                  label: label,
               })
            })
            //const renderTime = performance.now() - renderStartTime
            //console.log(`✅ WASM generated ${wasmRenderBuffers.segmentCount.toFixed(2)} render segments in ${renderTime.toFixed(2)}ms`)

            // Store render buffers for mesh creation
            this.wasmRenderBuffers = wasmRenderBuffers
            // this.processingStats.wasmRenderTime = renderTime
            this.processingStats.renderSegmentsGenerated = wasmRenderBuffers.segmentCount

            // Still need to create G-code line objects for compatibility with existing code
            console.log('🔧 Building TypeScript G-code objects for compatibility...')
            const compatStartTime = performance.now()

            // Reset processor state for TypeScript parsing phase
            this.processorProperties = this.buildProcessorProperties(file)

            await this.loadFileStreamedWithPositions(file)
            const compatTime = performance.now() - compatStartTime
            console.log(`🔧 TypeScript compatibility objects created in ${compatTime.toFixed(2)}ms`)
         } catch (error) {
            console.error('❌ WASM render buffer generation failed:', error)
            console.warn('🔄 Using TypeScript fallback for rendering...')
            // Fallback to TypeScript rendering
            const tsStartTime = performance.now()
            console.log('🔧 Building TypeScript G-code objects for rendering...')

            // Reset processor state for TypeScript parsing phase
            this.processorProperties = this.buildProcessorProperties(file)

            await this.loadFileStreamedWithPositions(file)
            this.processingStats.typescriptTime = performance.now() - tsStartTime
         }

         // Everything is copied to the JS side now; free the wasm-side tracker and segments so the
         // next load reuses linear memory instead of growing it
         this.wasmProcessor!.clearData()

         // Report final performance comparison
         const totalWasmTime = (this.processingStats.wasmTime || 0) + (this.processingStats.typescriptTime || 0)
         const efficiency = this.processingStats.wasmTime
            ? Math.round((this.processingStats.wasmTime / totalWasmTime) * 100)
            : 0
         console.log(`🎯 Hybrid processing complete - WASM: ${efficiency}%, TypeScript: ${100 - efficiency}%`)
      } catch (error) {
         console.error('💥 WASM processing error, falling back to TypeScript parser:', error)
         this.lastProcessingMethod = 'typescript'
         this.processingStats.method = 'typescript-fallback'
         await this.loadFileStreamed(file)
      }
   }

   private async loadFileStreamedWithPositions(file: string) {
      // Lightweight version of loadFileStreamed that leverages WASM position data
      const chunkSize = 10000
      let pos = 0

      const lines = this.streamLines(file)

      // Reset processor properties for TypeScript processing
      this.processorProperties.lineNumber = 0
      this.processorProperties.filePosition = 0

      for (let chunkStart = 0; chunkStart < lines.length; chunkStart += chunkSize) {
         const chunkEnd = Math.min(chunkStart + chunkSize, lines.length)

         // Process chunk with error handling
         for (let idx = chunkStart; idx < chunkEnd; idx++) {
            try {
               const line = lines[idx]
               this.processorProperties.lineNumber = idx + 1
               this.processorProperties.filePosition = pos
               pos += line.length + 1

               // Skip temperature commands that aren't visualized (M104, M109, M140, M190, etc.)
               const trimmedLine = line.trim().toUpperCase()
               if (
                  trimmedLine.startsWith('M104') ||
                  trimmedLine.startsWith('M109') ||
                  trimmedLine.startsWith('M140') ||
                  trimmedLine.startsWith('M190') ||
                  trimmedLine.startsWith('M155')
               ) {
                  // Create a simple comment object for temperature commands to maintain line count
                  const gcodeLine = ProcessLine(this.processorProperties, ';' + line)
                  this.gCodeLines.push(gcodeLine)
                  continue
               }

               const gcodeLine = ProcessLine(this.processorProperties, line)
               this.gCodeLines.push(gcodeLine)
            } catch (error) {
               console.error(`Error processing line ${idx + 1}: "${lines[idx]}"`, error)
               // Continue processing other lines
            }
         }

         // Report progress less frequently
         const progress = chunkEnd / lines.length
         if (progress - this.lastReportedProgress >= 0.02 || chunkEnd - this.lastReportedChunk >= 50000) {
            this.worker.postMessage({
               type: 'progress',
               progress: progress,
               label: 'Building render objects',
            })
            this.lastReportedProgress = progress
            this.lastReportedChunk = chunkEnd
         }

         // Yield control
         if (chunkEnd < lines.length) {
            this.throwIfCancelled()
            await new Promise((resolve) => setTimeout(resolve, 0))
         }
      }
   }

   addNewMaterial(): LineShaderMaterial {
      const m = new LineShaderMaterial(this.scene)
      this.modelMaterial.push(m)
      return m
   }

   async testRenderSceneProgressive() {
      const renderlines = []
      let segmentCount = 0
      let lastRenderedIdx = 0
      let alphaIndex = 0

      for (let idx = 0; idx < this.gCodeLines.length - 1; idx++) {
         const gCodeline = this.gCodeLines[idx] as Move
         try {
            // Zero-length moves (E-only retracts/recoveries) have no direction vector - renderLine
            // would emit NaN matrices that poison the thin-instance bounding boxes
            const zeroLength =
               (gCodeline.lineType === 'L' || gCodeline.lineType === 'T') &&
               gCodeline.start[0] === gCodeline.end[0] &&
               gCodeline.start[1] === gCodeline.end[1] &&
               gCodeline.start[2] === gCodeline.end[2]
            if (zeroLength) {
               // skip
            } else if (gCodeline.lineType === 'L' && gCodeline.extruding) {
               //Regular move
               renderlines.push(gCodeline)
               segmentCount++
            } else if (gCodeline.lineType === 'A' && gCodeline.extruding) {
               //Arc Move
               renderlines.push(gCodeline)
               segmentCount += (this.gCodeLines[idx] as ArcMove).segments.length
            } else if (gCodeline.lineType === 'T') {
               //Travel
               renderlines.push(gCodeline)
               segmentCount++
            }
         } catch (ex) {
            console.log(this.gCodeLines[idx], ex)
         }

         if (segmentCount >= this.breakPoint) {
            alphaIndex++

            const sl = renderlines.slice(lastRenderedIdx)
            const rl = this.testBuildMesh(sl, segmentCount, alphaIndex)
            this.meshes.push(...rl)
            this.gpuPicker.addToRenderList(rl[0]) //use the box mesh for all picking
            lastRenderedIdx = renderlines.length
            segmentCount = 0

            this.worker.postMessage({
               type: 'progress',
               progress: idx / this.gCodeLines.length,
               label: 'Generating model.',
            })

            // Yield control every few mesh generations
            if (alphaIndex % 5 === 0) {
               this.throwIfCancelled()
               await new Promise((resolve) => setTimeout(resolve, 0))
            }
         }
      }

      if (segmentCount > 0) {
         const sl = renderlines.slice(lastRenderedIdx)
         const rl = this.testBuildMesh(sl, segmentCount, alphaIndex)
         this.meshes.push(...rl)
         this.gpuPicker.addToRenderList(rl[0]) //use the box mesh for all picking
      }

      this.worker.postMessage({
         type: 'progress',
         progress: 1,
         label: 'Generating model.',
      })

      this.modelMaterial.forEach((m) => {
         m.updateCurrentFilePosition(this.filePosition)
         m.updateToolColors(this.processorProperties.buildToolFloat32Array())
      })
   }

   // 0 = Box
   // 1 = cyl
   // 2 = line
   setMeshMode(mode) {
      // this.scene.unfreezeActiveMeshes()
      mode = mode > 2 ? 0 : mode
      this.meshes.forEach((m) => m.setEnabled(false))
      for (let idx = mode; idx < this.meshes.length; idx += 3) {
         this.meshes[idx].setEnabled(true)
      }
      this.lastMeshMode = mode
   }

   testBuildMesh(renderlines, segCount, alphaIndex): Mesh[] {
      const box = MeshBuilder.CreateBox('box', { width: 1, height: 1, depth: 1 }, this.scene)
      box.position = new Vector3(0, 0, 0)
      box.rotate(Axis.X, Math.PI / 4, Space.LOCAL)
      box.bakeCurrentTransformIntoVertices()
      //box.convertToUnIndexedMesh()

      const cyl = MeshBuilder.CreateCylinder('cyl', { height: 1, diameter: 1 }, this.scene)
      cyl.locallyTranslate(new Vector3(0, 0, 0))
      cyl.rotate(new Vector3(0, 0, 1), Math.PI / 2, Space.WORLD)
      cyl.bakeCurrentTransformIntoVertices()

      const line = MeshBuilder.CreateLines(
         'line',
         {
            points: [new Vector3(-0.5, 0, 0), new Vector3(0.5, 0, 0)],
         },
         this.scene,
      )

      const matrixData = new Float32Array(16 * segCount)
      const colorData = new Float32Array(4 * segCount)
      const pickData = new Float32Array(3 * segCount)
      const filePositionData = new Float32Array(segCount)
      const fileEndPositionData = new Float32Array(segCount)
      const toolData = new Float32Array(segCount)
      const feedRate = new Float32Array(segCount)
      const isPerimeter = new Float32Array(segCount)

      box.material = this.addNewMaterial().material
      box.alphaIndex = alphaIndex
      //box.material.freeze()

      cyl.material = this.addNewMaterial().material
      cyl.alphaIndex = alphaIndex
      //cyl.material.freeze()

      const mm = this.addNewMaterial()
      line.alphaIndex = alphaIndex
      line.material = mm.material
      mm.setLineMesh(true)
      //line.material.freeze()

      //  box.name = `Mesh${this.meshes.length}}`

      let segIdx = 0
      for (let idx = 0; idx < renderlines.length; idx++) {
         const line = renderlines[idx] as Base
         if (line.lineType === 'L' || line.lineType === 'T') {
            const l = line as Move
            const lineData = l.renderLine(this.extrusionWidth(), 0.2, this.extrusionHeight(l.layerHeight))
            buildBuffers(lineData, l, segIdx)
            this.gCodeLines[line.lineNumber - 1] = new Move_Thin(this.processorProperties, line as Move) //remove unnecessary information now that we have the matrix
            segIdx++
         } else if (line.lineType === 'A') {
            const arc = line as ArcMove
            //run all the segments
            for (const seg in arc.segments) {
               const segment = arc.segments[seg] as Move
               const lineData = segment.renderLine(this.extrusionWidth() * 0.95, 0.3, this.extrusionHeight(segment.layerHeight))
               buildBuffers(lineData, arc, segIdx)
               segIdx++
            }
            this.gCodeLines[line.lineNumber - 1] = new Move_Thin(this.processorProperties, line as ArcMove) //remove unnecessary information now that we have the matrix
         }
      }

      copyBuffers(box)
      copyBuffers(cyl)
      cyl.setEnabled(false)
      copyBuffers(line)
      line.setEnabled(false)

      return [box, cyl, line]

      function copyBuffers(m: Mesh) {
         //let matrixDataClone = Float32Array.from(matrixData) //new Float32Array(matrixData)
         m.thinInstanceSetBuffer('matrix', matrixData, 16, true)
         m.doNotSyncBoundingInfo = true
         m.thinInstanceRefreshBoundingInfo(false)
         m.thinInstanceSetBuffer('baseColor', colorData, 4, true)
         m.thinInstanceSetBuffer('pickColor', pickData, 3, true) //this holds the color ids for the mesh
         m.thinInstanceSetBuffer('filePosition', filePositionData, 1, true)
         m.thinInstanceSetBuffer('filePositionEnd', fileEndPositionData, 1, true)
         m.thinInstanceSetBuffer('tool', toolData, 1, true)
         m.thinInstanceSetBuffer('feedRate', feedRate, 1, true)
         m.thinInstanceSetBuffer('isPerimeter', isPerimeter, 1, true)
         //         m.freezeWorldMatrix()
         m.isPickable = false
      }

      //Inner function with access to buffers
      function buildBuffers(lineData: MoveData, line: ArcMove | Move, idx: number) {
         lineData.Matrix.copyToArray(matrixData, idx * 16)
         colorData.set(lineData.Color, idx * 4)
         pickData.set([line.colorId[0] / 255, line.colorId[1] / 255, line.colorId[2] / 255], idx * 3)
         filePositionData.set([line.filePosition], idx) //Record the file position with the mesh
         fileEndPositionData.set([line.filePosition + line.lineLength], idx) //Record the file position with the mesh
         toolData.set([line.tool], idx)
         feedRate.set([line.feedRate], idx)
         isPerimeter.set([line.isPerimeter ? 1 : 0], idx)
      }
   }

   getGCodeInRange(filePos, count = 20) {
      let idx = binarySearchClosest(this.gCodeLines, filePos, 'filePosition')

      if (this.gCodeLines[idx].filePosition > filePos) idx--

      let min = Math.max(0, idx - count / 2)
      let max = Math.min(idx + count / 2, this.gCodeLines.length - 1)

      if (count % 2 == 1) {
         min++
         max++
      }

      const sub = this.gCodeLines.slice(min, max)
      const lines = []
      for (const l of sub) {
         lines.push({
            line: this.lineText(l),
            lineNumber: l.lineNumber,
            filePosition: l.filePosition,
            lineType: l.lineType,
            focus: false,
         })
      }

      const f = lines.find((f) => f.lineNumber == this.gCodeLines[idx].lineNumber)
      if (f) f.focus = true

      this.worker.postMessage({ type: 'getgcodes', lines: lines })
   }

   updateFilePosition(position: number, animate: boolean = false) {
      this.filePosition = position // Store the current position
      this.renderedFilePosition = position
      this.modelMaterial.forEach((m) => m.updateCurrentFilePosition(position)) //Set it to the end
      this.gpuPicker.updateCurrentPosition(position)

      // Update nozzle position based on G-code position
      if (this.nozzle && this.positionTracker.size > 0) {
         if (this.isPlaying && !animate) {
            // Manual position change during animation - skip to position and continue playing
            this.skipToPosition(position)
         } else if (!this.isPlaying) {
            // Normal position update when not playing
            if (animate) {
               this.updateNozzlePositionAnimated(position)
            } else {
               this.updateNozzlePositionInstant(position)
            }
         }
         // If animate is true and playing, let the animation continue naturally
      }
   }

   // Nearest tracked position to a file offset, via binary search over sortedPositions. Live job
   // following calls this on every print-head tick, so a linear Map scan would be O(n) per update
   private closestPositionData(filePosition: number) {
      if (this.sortedPositions.length === 0) {
         return null
      }
      return this.positionTracker.get(this.sortedPositions[this.findClosestPositionIndex(filePosition)]) ?? null
   }

   private updateNozzlePositionInstant(filePosition: number) {
      if (!this.nozzle) return

      const closestPosition = this.closestPositionData(filePosition)
      if (closestPosition) {
         this.nozzle.setPosition({
            x: closestPosition.x,
            y: closestPosition.y,
            z: closestPosition.z,
         })
      }
   }

   private updateNozzlePositionAnimated(filePosition: number) {
      if (!this.nozzle) return

      const closestPosition = this.closestPositionData(filePosition)
      if (closestPosition) {
         // Create a fake Move object for the nozzle animation
         const fakeMove = {
            end: [closestPosition.x, closestPosition.y, closestPosition.z],
            feedRate: closestPosition.feedRate,
            extruding: closestPosition.extruding,
         }

         // Create movement and animate to it
         const movement = this.nozzle.createMovementFromGCode(fakeMove as any, this.nozzle.getCurrentPosition())
         this.nozzle.moveToPosition(movement)
      }
   }

   async animateNozzleToPosition(targetPosition: number): Promise<void> {
      if (!this.nozzle || this.gCodeLines.length === 0) return

      const currentIdx = binarySearchClosest(this.gCodeLines, this.filePosition, 'filePosition')
      const targetIdx = binarySearchClosest(this.gCodeLines, targetPosition, 'filePosition')

      // Animate through moves between current and target position
      const startIdx = Math.min(currentIdx, targetIdx)
      const endIdx = Math.max(currentIdx, targetIdx)

      for (let i = startIdx; i <= endIdx; i++) {
         const gcodeLine = this.gCodeLines[i]
         if (gcodeLine && gcodeLine.lineType === 'L') {
            const move = gcodeLine as Move
            const movement = this.nozzle.createMovementFromGCode(move, this.nozzle.getCurrentPosition())
            await this.nozzle.moveToPosition(movement)
         }
      }
   }

   // World-space bounding box of the extruding moves, ignoring travels so a Z hop or a purge line
   // off to the side cannot inflate it. `upToFilePosition` limits it to what has printed so far.
   // Null before anything extruding has been parsed
   getExtrusionBounds(upToFilePosition?: number): { min: Vector3; max: Vector3 } | null {
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      for (const filePosition of this.sortedPositions) {
         if (upToFilePosition !== undefined && filePosition > upToFilePosition) {
            break
         }
         const position = this.positionTracker.get(filePosition)
         if (!position || !position.extruding) {
            continue
         }
         minX = Math.min(minX, position.x)
         maxX = Math.max(maxX, position.x)
         minY = Math.min(minY, position.y)
         maxY = Math.max(maxY, position.y)
         minZ = Math.min(minZ, position.z)
         maxZ = Math.max(maxZ, position.z)
      }
      return Number.isFinite(minX) ? { min: new Vector3(minX, minY, minZ), max: new Vector3(maxX, maxY, maxZ) } : null
   }

   updateByLineNumber(lineNumber: number) {
      this.updateFilePosition(this.gCodeLines[lineNumber - 1].filePosition)
   }

   private async buildMeshesFromWasmBuffers(wasmBuffers: any) {
      console.log('🔧 Building meshes directly from WASM render buffers...')
      const startTime = performance.now()

      // Create single mesh set from WASM buffers
      const meshes = this.createMeshesFromWasmBuffers(wasmBuffers)

      this.meshes.push(...meshes)
      this.gpuPicker.addToRenderList(meshes[0]) // Use the first mesh for picking

      // The geometry lives in the mesh buffers now; slim the fully parsed moves down the same way
      // the TS path does, so the hybrid path does not retain start/end/color arrays per line
      for (let idx = 0; idx < this.gCodeLines.length; idx++) {
         const l = this.gCodeLines[idx]
         if (l.lineType === 'L' || l.lineType === 'T' || l.lineType === 'A') {
            this.gCodeLines[idx] = new Move_Thin(this.processorProperties, l as Move)
         }
      }

      // Update materials
      this.modelMaterial.forEach((m) => {
         m.updateCurrentFilePosition(this.filePosition)
         m.updateToolColors(this.processorProperties.buildToolFloat32Array())
      })

      this.worker.postMessage({
         type: 'progress',
         progress: 1,
         label: 'Generating model.',
      })

      const buildTime = performance.now() - startTime
      console.log(
         `✅ WASM mesh building completed in ${buildTime.toFixed(2)}ms for ${wasmBuffers.segmentCount} segments`,
      )
   }

   private createMeshesFromWasmBuffers(wasmBuffers: any): Mesh[] {
      // Create box mesh
      const box = MeshBuilder.CreateBox('box', { width: 1, height: 1, depth: 1 }, this.scene)
      box.position = new Vector3(0, 0, 0)
      box.rotate(Axis.X, Math.PI / 4, Space.LOCAL)
      box.bakeCurrentTransformIntoVertices()

      // Create cylinder mesh
      const cyl = MeshBuilder.CreateCylinder('cyl', { height: 1, diameter: 1 }, this.scene)
      cyl.locallyTranslate(new Vector3(0, 0, 0))
      cyl.rotate(new Vector3(0, 0, 1), Math.PI / 2, Space.WORLD)
      cyl.bakeCurrentTransformIntoVertices()

      // Create line mesh
      const line = MeshBuilder.CreateLines(
         'line',
         {
            points: [new Vector3(-0.5, 0, 0), new Vector3(0.5, 0, 0)],
         },
         this.scene,
      )

      // Assign materials and alpha index
      const alphaIndex = 0
      box.material = this.addNewMaterial().material
      box.alphaIndex = alphaIndex

      cyl.material = this.addNewMaterial().material
      cyl.alphaIndex = alphaIndex

      const mm = this.addNewMaterial()
      line.alphaIndex = alphaIndex
      line.material = mm.material
      mm.setLineMesh(true)

      // Apply WASM buffers directly to all meshes
      this.applyWasmBuffersToMesh(box, wasmBuffers)
      this.applyWasmBuffersToMesh(cyl, wasmBuffers)
      this.applyWasmBuffersToMesh(line, wasmBuffers)

      return [box, cyl, line]
   }

   private applyWasmBuffersToMesh(mesh: Mesh, wasmBuffers: any) {
      // Apply WASM-generated buffer data directly to mesh
      const segmentCount = wasmBuffers.segmentCount

      // Set the matrix data (transformations)
      mesh.thinInstanceSetBuffer('matrix', wasmBuffers.matrixData, 16, false)

      // Set color data (match attribute name used elsewhere)
      mesh.thinInstanceSetBuffer('baseColor', wasmBuffers.colorData, 4, false)

      // Set other buffer data (use consistent attribute names and component sizes)
      mesh.thinInstanceSetBuffer('pickColor', wasmBuffers.pickData, 3, false)
      mesh.thinInstanceSetBuffer('filePosition', wasmBuffers.filePositionData, 1, false)
      mesh.thinInstanceSetBuffer('filePositionEnd', wasmBuffers.fileEndPositionData, 1, false)
      mesh.thinInstanceSetBuffer('tool', wasmBuffers.toolData, 1, false)
      mesh.thinInstanceSetBuffer('feedRate', wasmBuffers.feedRateData, 1, false)
      mesh.thinInstanceSetBuffer('isPerimeter', wasmBuffers.isPerimeterData, 1, false)

      mesh.thinInstanceCount = segmentCount

      console.log(`📊 Applied WASM buffers to ${mesh.name}: ${segmentCount} instances`)
   }

   // Every parse pass starts from a fresh ProcessorProperties, so the parse-time configuration is
   // re-applied here rather than at each of the call sites
   private buildProcessorProperties(file: string): ProcessorProperties {
      const props = new ProcessorProperties()
      props.slicer = slicerFactory(file)
      props.cncMode = this.g1AsExtrusion
      props.zBelt = this.zBelt
      props.setGantryAngle(this.gantryAngle)
      return props
   }

   // Re-applied after every load, so a user-set range is not clobbered by the parsed one
   applyFeedRateRange() {
      const min = this.userMinFeedRate ?? this.processorProperties.minFeedRate
      const max = this.userMaxFeedRate ?? this.processorProperties.maxFeedRate
      this.modelMaterial.forEach((m) => m.setMinFeedRate(min))
      this.modelMaterial.forEach((m) => m.setMaxFeedRate(max))
   }

   // Null for either end restores the parsed value for that end
   setFeedRateRange(min: number | null, max: number | null) {
      this.userMinFeedRate = min
      this.userMaxFeedRate = max
      this.applyFeedRateRange()
   }

   // Absolute nozzle marker position, bypassing the file-position tracker entirely. Takes
   // G-code coordinates and applies the Babylon axis swap
   setNozzlePosition(x: number, y: number, z: number, animate: boolean) {
      const nozzle = this.getNozzle()
      if (!nozzle) {
         return
      }
      const position = { x: x, y: z, z: y }
      if (animate) {
         nozzle.moveToPosition({ startPos: nozzle.getCurrentPosition(), endPos: position, feedRate: 1500, duration: 0, isExtruding: false })
      } else {
         nozzle.forcePosition(position)
      }
   }

   // In high quality mode the geometry follows the machine: extrusion width from the tool
   // diameter, height from the layer height measured while parsing
   private extrusionWidth(): number {
      return this.hqRendering ? this.getNozzleDiameter() : DEFAULT_NOZZLE_SIZE
   }

   // null for either value drops that step out of the resolution order
   setNozzleDiameter(override: number | null, fallback: number | null) {
      this.nozzleDiameterOverride = override
      this.nozzleDiameterFallback = fallback
   }

   getNozzleDiameter(): number {
      return this.nozzleDiameterOverride ?? this.parsedNozzleDiameter ?? this.nozzleDiameterFallback ?? DEFAULT_NOZZLE_SIZE
   }

   // Slicers spell it 'nozzle_diameter' or 'nozzle diameter' and may list one value per extruder.
   // The PrusaSlicer family writes its config block at the END of the file, so both ends are
   // searched rather than just the header
   private findNozzleDiameter(file: string): number | null {
      const pattern = /^;\s*(?:nozzle[_ ]diameter|nozzle[_ ]size)\s*[:=]\s*([\d.]+)/im
      const chunks = file.length > 2 * HEADER_SCAN_BYTES
         ? [file.substring(0, HEADER_SCAN_BYTES), file.substring(file.length - HEADER_SCAN_BYTES)]
         : [file]
      for (const chunk of chunks) {
         const match = pattern.exec(chunk)
         const value = match ? Number(match[1]) : NaN
         if (value > 0 && value < 10) {
            return value
         }
      }
      return null
   }

   private extrusionHeight(measured: number): number {
      return this.hqRendering ? measured : DEFAULT_LAYER_HEIGHT
   }

   setHQRendering(enabled: boolean) {
      this.hqRendering = enabled
   }

   // Treat G1 without an E parameter as extruding, for CNC and laser files. Needs a reload
   setG1AsExtrusion(enabled: boolean) {
      this.g1AsExtrusion = enabled
      this.wasmProcessor?.setG1AsExtrusion(enabled)
   }

   // Belt printer geometry, angle in degrees. Needs a reload
   setZBelt(enabled: boolean, gantryAngle: number) {
      this.zBelt = enabled
      this.gantryAngle = gantryAngle
      this.wasmProcessor?.setZBelt(enabled, gantryAngle)
   }

   // Toggles a shader uniform on the existing meshes - the geometry always carries every segment, so
   // this is a cheap material change with no reparse
   setPerimeterOnly(perimeterOnly: boolean) {
      this.perimeterOnly = perimeterOnly
      this.modelMaterial.forEach((m) => m.setPerimeterOnly(perimeterOnly))
   }

   showSupports(show) {
      this.modelMaterial.forEach((m) => m.showSupports(show))
   }

   // Animation control methods
   startNozzleAnimation(): void {
      if (!this.nozzle || this.sortedPositions.length === 0) {
         console.warn('Cannot start animation: nozzle or positions not available')
         return
      }

      if (this.isPlaying) {
         console.log('Animation already playing, continuing from current position')
         return
      }

      console.log('Starting animation from current file position:', this.filePosition)

      this.isPlaying = true

      // Notify UI that animation started
      this.worker.postMessage({
         type: 'animationStarted',
         currentPosition: this.getCurrentAnimationIndex(),
         totalPositions: this.sortedPositions.length,
      })

      // Start immediately without await to prevent blocking
      this.animateToNextPosition()
   }

   pauseNozzleAnimation(): void {
      if (!this.isPlaying) {
         console.log('Animation not playing, nothing to pause')
         return
      }

      this.isPlaying = false

      if (this.playbackTimeout) {
         clearTimeout(this.playbackTimeout)
         this.playbackTimeout = null
      }

      if (this.nozzle) {
         this.nozzle.stopAnimation()
      }

      // Notify UI that animation paused
      this.worker.postMessage({
         type: 'animationPaused',
         currentPosition: this.getCurrentAnimationIndex(),
         totalPositions: this.sortedPositions.length,
      })
   }

   resumeNozzleAnimation(): void {
      if (this.isPlaying) {
         console.log('Animation already playing')
         return
      }

      if (!this.nozzle || this.sortedPositions.length === 0) {
         console.warn('Cannot resume animation: nozzle or positions not available')
         return
      }

      this.isPlaying = true

      // Notify UI that animation resumed
      this.worker.postMessage({
         type: 'animationResumed',
         currentPosition: this.getCurrentAnimationIndex(),
         totalPositions: this.sortedPositions.length,
      })

      // Continue from current position
      this.animateToNextPosition()
   }

   stopNozzleAnimation(): void {
      this.isPlaying = false

      if (this.playbackTimeout) {
         clearTimeout(this.playbackTimeout)
         this.playbackTimeout = null
      }

      if (this.nozzle) {
         this.nozzle.stopAnimation()
      }

      // Notify UI that animation stopped
      this.worker.postMessage({
         type: 'animationStopped',
      })
   }

   private animateToNextPosition(): void {
      if (!this.isPlaying || !this.nozzle) {
         return
      }

      const currentIndex = this.getCurrentAnimationIndex()
      if (currentIndex + 1 >= this.sortedPositions.length) {
         this.stopNozzleAnimation()
         return
      }

      // The 10 ms floor between moves caps throughput at ~100 moves/s however high the speed is set,
      // so past 10x whole batches are skipped over: only the last move of a batch gets tweened and
      // reported, the ones in between are simply not drawn
      const batchSize = Math.min(Math.ceil(this.nozzle.getAnimationSpeed() / 10), 500)
      const nextIndex = Math.min(currentIndex + batchSize, this.sortedPositions.length - 1)

      const nextFilePosition = this.sortedPositions[nextIndex]
      const positionData = this.positionTracker.get(nextFilePosition)

      if (positionData) {
         // Update file position to match animation progress - but don't trigger position change events
         this.filePosition = nextFilePosition
         this.renderedFilePosition = nextFilePosition
         this.modelMaterial.forEach((m) => m.updateCurrentFilePosition(nextFilePosition))
         this.gpuPicker.updateCurrentPosition(nextFilePosition)

         // Notify UI of position change
         this.worker.postMessage({
            type: 'animationPositionUpdate',
            position: nextFilePosition,
            progress: nextIndex / this.sortedPositions.length,
         })

         // Create movement for nozzle
         const fakeMove = {
            end: [positionData.x, positionData.y, positionData.z],
            feedRate: positionData.feedRate,
            extruding: positionData.extruding,
         }

         try {
            const movement = this.nozzle.createMovementFromGCode(fakeMove as any, this.nozzle.getCurrentPosition())

            // Use the actual calculated duration from nozzle movement instead of fixed delay
            this.nozzle
               .moveToPosition(movement)
               .then(() => {
                  if (this.isPlaying) {
                     // Use minimal delay - nozzle animation duration handles timing
                     this.playbackTimeout = window.setTimeout(() => {
                        this.animateToNextPosition()
                     }, 10)
                  }
               })
               .catch(() => {
                  if (this.isPlaying) {
                     this.playbackTimeout = window.setTimeout(() => {
                        this.animateToNextPosition()
                     }, 10)
                  }
               })
         } catch {
            if (this.isPlaying) {
               this.playbackTimeout = window.setTimeout(() => {
                  this.animateToNextPosition()
               }, 10)
            }
         }
      } else {
         if (this.isPlaying) {
            this.playbackTimeout = window.setTimeout(() => {
               this.animateToNextPosition()
            }, 10)
         }
      }
   }

   isNozzleAnimationPlaying(): boolean {
      return this.isPlaying
   }

   private getCurrentAnimationIndex(): number {
      return this.findClosestPositionIndex(this.filePosition)
   }

   private skipToPosition(targetFilePosition: number): void {
      if (!this.nozzle || this.sortedPositions.length === 0) {
         return
      }

      // Clear any existing timeout first
      if (this.playbackTimeout) {
         clearTimeout(this.playbackTimeout)
         this.playbackTimeout = null
      }

      // Stop current animation
      this.nozzle.stopAnimation()

      // Update file position - this is now the single source of truth
      this.filePosition = targetFilePosition

      // Find the closest position data for the nozzle
      const targetIndex = this.findClosestPositionIndex(targetFilePosition)
      if (targetIndex >= 0 && targetIndex < this.sortedPositions.length) {
         const positionData = this.positionTracker.get(this.sortedPositions[targetIndex])
         if (positionData) {
            // Set nozzle to the target position immediately
            this.nozzle.setPosition({
               x: positionData.x,
               y: positionData.y,
               z: positionData.z,
            })
         }
      }

      // Continue animation from this point if still playing
      if (this.isPlaying) {
         // Small delay before continuing to allow position to settle
         this.playbackTimeout = window.setTimeout(() => {
            this.animateToNextPosition()
         }, 150)
      }
   }

   private streamLines(file: string): string[] {
      // Fast line splitting without creating intermediate arrays
      const lines: string[] = []
      let start = 0

      for (let i = 0; i < file.length; i++) {
         if (file[i] === '\n') {
            lines.push(file.substring(start, i))
            start = i + 1
         }
      }

      // Handle last line if no trailing newline
      if (start < file.length) {
         lines.push(file.substring(start))
      }

      return lines
   }

   private findClosestPositionIndex(targetFilePosition: number): number {
      let left = 0
      let right = this.sortedPositions.length - 1
      let closestIndex = 0
      let minDistance = Infinity

      // Binary search for efficiency, then linear refinement for closest match
      while (left <= right) {
         const mid = Math.floor((left + right) / 2)
         const distance = Math.abs(this.sortedPositions[mid] - targetFilePosition)

         if (distance < minDistance) {
            minDistance = distance
            closestIndex = mid
         }

         if (this.sortedPositions[mid] < targetFilePosition) {
            left = mid + 1
         } else {
            right = mid - 1
         }
      }

      return closestIndex
   }
}
