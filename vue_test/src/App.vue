<script setup lang="ts">
import GCodeLine from './components/GCodeLine.vue'
import { Viewer_Proxy as Viewer_Inst } from '@duet3d/gcodeviewer'
import { ref, onMounted, onUnmounted, watch } from 'vue'
import debounce from 'lodash.debounce'

interface GCodeLineItem {
   line: string
   lineNumber: number
   lineType: string
   focus: boolean
   filePosition: number
}

let viewer: Viewer_Inst | null = null
const viewercanvas = ref(null)
const gcodeLine = ref({ line: '' })
const filePos = ref(0)
const renderMode = ref(0)
const playing = ref('mdi-play')
const start = ref(0)
const end = ref(0)
const lines = ref<GCodeLineItem[]>([])
const alpha = ref(false)
const progressMode = ref(false)
const meshMode = ref(0)
const progressValue = ref(100)
const progressLabel = ref('')
const fps = ref(999)
const perimeterOnly = ref(false)
const nozzleVisible = ref(false)
let isPlaying = false
let animationMode = false

// Processing stats
const processingStats = ref({
  method: 'none',
  wasmEnabled: false,
  wasmVersion: '',
  totalTime: 0,
  wasmTime: 0,
  typescriptTime: 0,
  wasmRenderTime: 0,
  linesProcessed: 0,
  movesFound: 0,
  positionsExtracted: 0,
  renderSegmentsGenerated: 0
})
const showDebugPanel = ref(false)

const renderModes = [
   { label: 'Feature', value: 0 },
   { label: 'Tool', value: 1 },
   { label: 'Feed Rate', value: 2 },
   { label: 'Color Index', value: 5 },
]

const meshModes = [
   { label: 'High', value: 1 },
   { label: 'Normal', value: 0 },
   { label: 'Line', value: 2 },
]

const fpsValues = [
   { label: 'Unlocked', value: 999 },
   { label: '60', value: 60 },
   { label: '30', value: 30 },
   { label: '15', value: 15 },
]

onMounted(async () => {
   if (viewercanvas.value != null) {
      viewer = new Viewer_Inst(viewercanvas.value)
      viewer.init()
      
      // Enable WASM processing for better performance
      try {
         await viewer.enableWasmProcessing()
         console.log('WASM processing enabled in Vue app')
      } catch (error) {
         console.warn('Failed to enable WASM processing:', error)
      }
      
      viewer.passThru = (e: any) => {
         switch (e.type) {
            case 'currentline':
               gcodeLine.value.line = e.line
               break
            case 'fileloaded':
               start.value = e.start
               end.value = e.end
               break
            case 'positionupdate':
               filePos.value = e.position
               break
            case 'getgcodes':
               lines.value.length = 0
               lines.value.push(...e.lines)
               lineNumber = lines.value.filter((l) => l.focus)[0]?.lineNumber ?? lineNumber
               break
            case 'progress':
               progressValue.value = Math.floor(e.progress * 100)
               progressLabel.value = e.label
               break
            case 'animationPositionUpdate':
               // Update UI position from nozzle animation
               if (animationMode) {
                  filePos.value = e.position
               }
               break
            case 'animationStopped':
               // Animation was stopped by the library
               playing.value = 'mdi-play'
               isPlaying = false
               animationMode = false
               console.log('Animation stopped by library')
               break
            case 'processingComplete':
               // Update processing stats from the event
               if (e.stats) {
                  processingStats.value = { ...e.stats }
                  console.log('Processing stats updated:', processingStats.value)
               }
               break
         }
      }
   }
})

onUnmounted(() => {})

async function refreshProcessingStats() {
   if (viewer && viewer.getProcessingStats) {
      try {
         const stats = await viewer.getProcessingStats()
         processingStats.value = { ...stats }
         console.log('Manually refreshed processing stats:', stats)
      } catch (error) {
         console.warn('Failed to get processing stats:', error)
      }
   }
}

async function openLocalFile(file: File): Promise<void> {
   if (!file) return
   const reader = new FileReader()
   reader.addEventListener('load', async (event) => {
      const blob = event?.target?.result
      viewer?.loadFile(blob)
   })
   reader.readAsText(file)
}

function dragOver(event: DragEvent): void {
   if ((event.dataTransfer?.files.length ?? -1) > 0) {
      //const  file = event.dataTransfer?.files[0]
   }
}

function dragLeave(): void {
   //Do nothing at the moment
}

async function drop(event: DragEvent): Promise<void> {
   if ((event.dataTransfer?.files.length ?? -1) > 0) {
      const file = event.dataTransfer?.files[0]
      if (file) {
         await openLocalFile(file)
      }
   }
}

watch(renderMode, (newVal) => {
   viewer?.setRenderMode(newVal)
})

watch(meshMode, (newVal) => {
   viewer?.setMeshMode(newVal)
})

watch(progressMode, (newVal) => {
   viewer?.setProgressMode(newVal)
})

watch(filePos, (newVal, oldVal) => {
   //console.log('File position changed:', newVal, 'isPlaying:', isPlaying, 'animationMode:', animationMode)
   // Always allow manual position updates, even during animation (for skipping)
   if (!animationMode || Math.abs(newVal - oldVal) > 1000) {
      // Large position changes (likely manual) should always be processed
      viewer?.updateFilePosition(newVal, false)
   } else if (!animationMode) {
      // Small changes when not animating
      viewer?.updateFilePosition(newVal, false)
   }
   // If it's a small change during animation, ignore it (automatic update)
})

watch(
   filePos,
   debounce(() => {
      viewer?.getGCodes(filePos.value, 21)
   }, 10),
)

watch(alpha, (newVal) => {
   viewer?.setAlphaMode(newVal)
})

watch(fps, (newVal) => {
   viewer?.setMaxFPS(newVal)
})

watch(perimeterOnly, (newVal) => {
   viewer?.setPerimeterOnly(newVal)
})

watch(nozzleVisible, (newVal) => {
   viewer?.toggleNozzle(newVal)
})

function filePosInput() {
   viewer?.updateFilePosition(filePos.value)
}

let timeOutId = -1
let lineNumber = 0
function toggleIncrement() {
   if (isPlaying) {
      // Stop any running animation
      if (timeOutId > 0) {
         window.clearInterval(timeOutId)
         timeOutId = -1
      }

      // Stop the nozzle animation system
      viewer?.stopNozzleAnimation()

      playing.value = 'mdi-play'
      isPlaying = false
      animationMode = false
      console.log('Stopped animation')
   } else {
      playing.value = 'mdi-stop'
      isPlaying = true
      animationMode = true

      console.log('Starting nozzle animation')
      // Start the synchronized nozzle animation system
      viewer?.startNozzleAnimation()
   }
}
function lineClicked(props: any[]) {
   filePos.value = props[0]
}

function getProcessingMethodColor(method: string): 'success' | 'info' | 'warning' | 'error' {
   switch (method) {
      case 'hybrid': return 'success'
      case 'wasm': return 'info'
      case 'typescript': return 'warning'
      case 'typescript-fallback': return 'error'
      default: return 'info'
   }
}

function getProcessingSpeed(): string {
   if (!processingStats.value.linesProcessed || !processingStats.value.totalTime) {
      return '0 lines/s'
   }
   const speed = Math.round(processingStats.value.linesProcessed / (processingStats.value.totalTime / 1000))
   return `${speed.toLocaleString()} lines/s`
}
</script>

<template>
   <header>
      <div class="gcodeline">{{ gcodeLine.line }}</div>
      <canvas
         ref="viewercanvas"
         class="canvasFull"
         tabindex="1"
         @dragover.prevent="dragOver"
         @dragleave="dragLeave"
         @drop.prevent="drop"
      />
      <v-select
         v-model="renderMode"
         item-title="label"
         item-value="value"
         class="reset"
         label="Render Mode"
         :items="renderModes"
      ></v-select>
      <v-select
         v-model="meshMode"
         item-title="label"
         item-value="value"
         class="meshes"
         label="Mesh Mode"
         :items="meshModes"
      ></v-select>
      <v-select
         v-model="fps"
         item-title="label"
         item-value="value"
         class="fps"
         label="FPS"
         :items="fpsValues"
      ></v-select>
      <form @submit.prevent="filePosInput">
         <v-text-field v-model="filePos" density="compact" variant="outlined" class="filePosInput" />
      </form>
      <v-btn class="filePlay" size="large" type="button" @click="toggleIncrement"
         ><v-icon :icon="playing"></v-icon
      ></v-btn>
      <div class="lines">
         <GCodeLine
            v-for="l in lines"
            :key="l.lineNumber"
            :line="l.line"
            :line-number="l.lineNumber"
            :line-type="l.lineType"
            :focus="l.focus"
            :file-position="l.filePosition"
            @selected="lineClicked"
         ></GCodeLine>
      </div>
      <div style="position: absolute; top: 10px; left: 10px; z-index: 11">
         <span>{{ start }}</span
         ><br />
         <span>{{ end }}</span>
      </div>
      <v-slider v-model="filePos" class="slider-pos" :min="start" :max="end" :step="1"></v-slider>
      <v-checkbox v-model="alpha" class="alpha">Set Alpha</v-checkbox>
      <v-checkbox v-model="progressMode" class="progress">Progress Mode</v-checkbox>
      <v-checkbox v-model="perimeterOnly" class="perimeterOnly">Perimeter Only</v-checkbox>
      <v-checkbox v-model="nozzleVisible" class="nozzle">Show Nozzle</v-checkbox>
      <v-checkbox v-model="showDebugPanel" class="debug-panel">Show Debug Panel</v-checkbox>
      
      <!-- Debug Panel -->
      <div v-if="showDebugPanel" class="debug-panel-container">
         <v-card class="debug-card" elevation="3">
            <v-card-title class="debug-title">
               <v-icon>mdi-bug</v-icon>
               Processing Debug Info
               <v-btn size="small" variant="outlined" @click="refreshProcessingStats">
                  <v-icon>mdi-refresh</v-icon> Refresh
               </v-btn>
            </v-card-title>
            <v-card-text>
               <v-row density="compact">
                  <v-col cols="12" md="6">
                     <v-alert 
                        :type="processingStats.wasmEnabled ? 'success' : 'warning'" 
                        density="compact"
                        :text="`WASM: ${processingStats.wasmEnabled ? 'Enabled' : 'Disabled'}`"
                        variant="tonal"
                     ></v-alert>
                  </v-col>
                  <v-col cols="12" md="6">
                     <v-alert 
                        :type="getProcessingMethodColor(processingStats.method)" 
                        density="compact"
                        :text="`Method: ${processingStats.method.toUpperCase()}`"
                        variant="tonal"
                     ></v-alert>
                  </v-col>
               </v-row>
               
               <v-divider class="my-2"></v-divider>
               
               <v-row v-if="processingStats.wasmVersion" density="compact">
                  <v-col cols="12">
                     <strong>WASM Version:</strong> {{ processingStats.wasmVersion }}
                  </v-col>
               </v-row>
               
               <v-row v-if="processingStats.linesProcessed > 0" density="compact">
                  <v-col cols="6" md="3">
                     <div class="stat-item">
                        <div class="stat-label">Lines</div>
                        <div class="stat-value">{{ processingStats.linesProcessed?.toLocaleString() || 0 }}</div>
                     </div>
                  </v-col>
                  <v-col cols="6" md="3">
                     <div class="stat-item">
                        <div class="stat-label">Moves</div>
                        <div class="stat-value">{{ processingStats.movesFound?.toLocaleString() || 0 }}</div>
                     </div>
                  </v-col>
                  <v-col cols="6" md="3">
                     <div class="stat-item">
                        <div class="stat-label">Positions</div>
                        <div class="stat-value">{{ processingStats.positionsExtracted?.toLocaleString() || 0 }}</div>
                     </div>
                  </v-col>
                  <v-col cols="6" md="3">
                     <div class="stat-item">
                        <div class="stat-label">Speed</div>
                        <div class="stat-value">{{ getProcessingSpeed() }}</div>
                     </div>
                  </v-col>
               </v-row>
               
               <v-divider v-if="processingStats.totalTime > 0" class="my-2"></v-divider>
               
               <v-row v-if="processingStats.totalTime > 0" density="compact">
                  <v-col cols="3">
                     <div class="stat-item">
                        <div class="stat-label">Total Time</div>
                        <div class="stat-value">{{ Math.round(processingStats.totalTime || 0) }}ms</div>
                     </div>
                  </v-col>
                  <v-col v-if="processingStats.wasmTime > 0" cols="3">
                     <div class="stat-item">
                        <div class="stat-label">WASM Parse</div>
                        <div class="stat-value">{{ Math.round(processingStats.wasmTime || 0) }}ms</div>
                     </div>
                  </v-col>
                  <v-col v-if="processingStats.wasmRenderTime > 0" cols="3">
                     <div class="stat-item">
                        <div class="stat-label">WASM Render</div>
                        <div class="stat-value">{{ Math.round(processingStats.wasmRenderTime || 0) }}ms</div>
                     </div>
                  </v-col>
                  <v-col v-if="processingStats.typescriptTime > 0" cols="3">
                     <div class="stat-item">
                        <div class="stat-label">TS Time</div>
                        <div class="stat-value">{{ Math.round(processingStats.typescriptTime || 0) }}ms</div>
                     </div>
                  </v-col>
               </v-row>
               
               <v-row v-if="processingStats.renderSegmentsGenerated > 0" density="compact">
                  <v-col cols="12">
                     <v-alert type="success" density="compact" variant="tonal">
                        🚀 WASM generated {{ processingStats.renderSegmentsGenerated?.toLocaleString() }} render segments
                     </v-alert>
                  </v-col>
               </v-row>
            </v-card-text>
         </v-card>
      </div>
      
      <div v-if="progressValue < 100" class="progressbar">
         <v-label>{{ progressLabel }}</v-label>
         <v-progress-linear :model-value="progressValue"></v-progress-linear>
      </div>
   </header>

   <main></main>
</template>

<style scoped>
header {
   line-height: 1.5;
}

.logo {
   display: block;
   margin: 0 auto 2rem;
}

@media (min-width: 1024px) {
   header {
      display: flex;
      place-items: center;
      padding-right: calc(var(--section-gap) / 2);
   }

   .logo {
      margin: 0 2rem 0 0;
   }

   header .wrapper {
      display: flex;
      place-items: flex-start;
      flex-wrap: wrap;
   }
}

.canvasFull {
   width: 100%;
   height: 100%;
   position: absolute;
   top: 0;
   left: 0;
   z-index: 10;
}
.gcodeline {
   position: absolute;
   top: 5px;
   left: 5px;
   z-index: 11;
   color: white;
}

/* Keep clear of the viewer cube overlay in the top-right corner */
.reset {
   position: absolute;
   top: 120px;
   right: 10px;
   z-index: 11;
   width: 300px;
   color: white;
}

.colortest {
   position: absolute;
   top: 30px;
   right: 5px;
   z-index: 11;
   color: white;
}

.filePosInput {
   position: absolute;
   top: 30px;
   left: 5px;
   z-index: 11;
   width: 200px;
}

.filePlay {
   position: absolute;
   top: 30px;
   left: 210px;
   z-index: 11;
}

.slider-pos {
   position: absolute;
   bottom: 30px;
   z-index: 11;
   left: 100px;
   right: 100px;
}
.lines {
   position: absolute;
   top: 100px;
   bottom: 30px;
   left: 10px;
   overflow: none;
   z-index: 11;
   color: white;
}

.alpha {
   position: absolute;
   top: 10px;
   right: 400px;
   z-index: 11;
   color: white;
}

.progress {
   position: absolute;
   top: 10px;
   right: 500px;
   z-index: 11;
   color: white;
}

.perimeterOnly {
   position: absolute;
   top: 10px;
   right: 600px;
   z-index: 11;
   color: white;
}

.nozzle {
   position: absolute;
   top: 10px;
   right: 700px;
   z-index: 11;
   color: white;
}

.meshes {
   position: absolute;
   top: 180px;
   right: 10px;
   z-index: 11;
   width: 300px;
   color: white;
}

.progressbar {
   position: absolute;
   top: 50%;
   right: calc(50% - 250px);
   z-index: 11;
   width: 500px;
   color: white;
}

.fps {
   position: absolute;
   top: 240px;
   right: 10px;
   z-index: 11;
   width: 300px;
   color: white;
}

.debug-panel {
   position: absolute;
   top: 10px;
   right: 800px;
   z-index: 11;
   color: white;
}

.debug-panel-container {
   position: absolute;
   top: 60px;
   left: 10px;
   z-index: 12;
   width: 500px;
   max-height: 400px;
   overflow-y: auto;
}

.debug-card {
   background: rgba(0, 0, 0, 0.9) !important;
   color: white;
}

.debug-title {
   display: flex;
   align-items: center;
   gap: 8px;
   padding: 12px 16px;
}

.debug-title .v-btn {
   margin-left: auto;
}

.stat-item {
   text-align: center;
   padding: 8px;
}

.stat-label {
   font-size: 0.8em;
   color: rgba(255, 255, 255, 0.7);
   margin-bottom: 4px;
}

.stat-value {
   font-size: 1.1em;
   font-weight: bold;
   color: white;
}
</style>
