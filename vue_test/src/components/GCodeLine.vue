<template>
   <div class="gcode-line prevent-select" :class="{ focused: focus }" :title="line" @click.prevent="lineClicked">
      <span :style="{ borderRightColor: background }" class="line-number">{{ `${lineNumber} : ${filePosition}` }}</span>
      <span class="line-content">{{ line }}</span>
   </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
   lineNumber?: number
   line?: string
   lineType?: string
   focus?: boolean
   filePosition?: number
}

const props = withDefaults(defineProps<Props>(), {
   lineNumber: 0,
   line: '',
   lineType: '',
   focus: false,
   filePosition: 0,
})

const emit = defineEmits(['selected'])

function lineClicked() {
   emit('selected', [props.filePosition])
}

const background = computed(() => {
   switch (props.lineType) {
      case 'C':
         return '#00aebd'
      case 'A':
         return '#ffc425'
      case 'L':
         return '#f3773f'
      case 'M':
         return '#00b159'
      case 'T':
         return '#d11141'
      case 'G':
         return '#888888'
      default:
         return '#000000'
   }
})
</script>

<style scoped>
.gcode-line {
   cursor: pointer;
   border: 1px solid #888888;
   width: 350px;
   max-width: 350px;
   font-size: 12px;
   height: 18px;
   background-color: #000000aa;
   text-overflow: clip;
   white-space: nowrap;
   overflow: hidden;
}
.prevent-select {
   -webkit-user-select: none; /* Safari */
   -ms-user-select: none; /* IE 10 and IE 11 */
   user-select: none; /* Standard syntax */
}
.focused {
   border-color: greenyellow;
}

.line-number {
   padding-right: 20px;
   border-right-width: 8px;
   border-right-style: groove;

   margin-right: 5px;
}

.line-content {
   color: white;
}
</style>
