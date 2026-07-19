import init, { GCodeProcessor, ProcessingResult, RenderBuffers, get_version } from '../WASM_FileProcessor/pkg/gcode_file_processor';

export interface WasmProcessingResult {
    success: boolean;
    errorMessage: string;
    lineCount: number;
    moveCount: number;
    processingTimeMs: number;
}

export interface WasmRenderBuffers {
    segmentCount: number;
    matrixData: Float32Array;
    colorData: Float32Array;
    pickData: Float32Array;
    filePositionData: Float32Array;
    fileEndPositionData: Float32Array;
    toolData: Float32Array;
    feedRateData: Float32Array;
    isPerimeterData: Float32Array;
}

export class WasmProcessor {
    private processor: GCodeProcessor | null = null;
    private initialized: boolean = false;

    async initialize(): Promise<void> {
        if (!this.initialized) {
            await init();
            this.processor = new GCodeProcessor();
            this.initialized = true;
            console.log(`WASM G-code processor initialized - v${get_version()}`);
        }
    }

    async processFile(
        content: string,
        progressCallback?: (progress: number, label: string) => void
    ): Promise<WasmProcessingResult> {
        if (!this.initialized || !this.processor) {
            throw new Error('WASM processor not initialized. Call initialize() first.');
        }

        const result: ProcessingResult = this.processor.process_file(content, progressCallback);
        const mapped = {
            success: result.success,
            errorMessage: result.error_message,
            lineCount: result.line_count,
            moveCount: result.move_count,
            processingTimeMs: result.processing_time_ms
        };
        result.free();
        return mapped;
    }

    // Packed [filePosition, x, y, z, feedRate, extruding] per entry, sorted by file position
    getPositionBuffer(): Float64Array {
        if (!this.initialized || !this.processor) {
            throw new Error('WASM processor not initialized');
        }

        return this.processor.get_position_buffer();
    }

    generateRenderBuffers(nozzleSize: number = 0.4, padding: number = 0, progressCallback?: (progress: number, label: string) => void): WasmRenderBuffers {
        if (!this.initialized || !this.processor) {
            throw new Error('WASM processor not initialized');
        }

        // take_* moves each buffer across the boundary once; free() releases the emptied wasm object
        // immediately instead of waiting for the FinalizationRegistry
        const renderBuffers: RenderBuffers = this.processor.generate_render_buffers(nozzleSize, padding, progressCallback);
        const result = {
            segmentCount: renderBuffers.segment_count,
            matrixData: renderBuffers.take_matrix_data(),
            colorData: renderBuffers.take_color_data(),
            pickData: renderBuffers.take_pick_data(),
            filePositionData: renderBuffers.take_file_position_data(),
            fileEndPositionData: renderBuffers.take_file_end_position_data(),
            toolData: renderBuffers.take_tool_data(),
            feedRateData: renderBuffers.take_feed_rate_data(),
            isPerimeterData: renderBuffers.take_is_perimeter_data(),
        };
        renderBuffers.free();
        return result;
    }

    // Drop the parsed data held in wasm linear memory once JS has copied what it needs
    clearData(): void {
        this.processor?.clear_data();
    }

    dispose(): void {
        if (this.processor) {
            this.processor.free();
            this.processor = null;
        }
        this.initialized = false;
    }
}
