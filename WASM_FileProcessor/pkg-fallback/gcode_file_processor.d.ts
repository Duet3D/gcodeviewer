/* tslint:disable */
/* eslint-disable */

export class GCodeProcessor {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Free the parsed data once JS has copied everything it needs. Linear memory never shrinks,
     * but this lets the next load reuse the space instead of growing further
     */
    clear_data(): void;
    /**
     * Generate render buffers for fast mesh creation in JavaScript
     * `high_quality` switches from the fixed default extrusion height to the layer height
     * measured while parsing
     */
    generate_render_buffers(nozzle_size: number, padding: number, high_quality: boolean, progress_callback?: any | null): RenderBuffers;
    /**
     * All tracked positions as one packed buffer, sorted by file position:
     * [file_position, x, y, z, feed_rate, extruding] per entry. One boundary crossing instead of
     * one wasm object per move
     */
    get_position_buffer(): Float64Array;
    constructor();
    /**
     * Process G-code file and return results
     */
    process_file(file_content: string, progress_callback?: any | null): ProcessingResult;
    /**
     * Parse-time configuration. Both outlive `ProcessorProperties::reset()`, so they only need to
     * be set once per processor, but the caller must reload the file for them to take effect
     */
    set_g1_as_extrusion(enabled: boolean): void;
    set_z_belt(enabled: boolean, gantry_angle_degrees: number): void;
}

export class PositionData {
    free(): void;
    [Symbol.dispose](): void;
    constructor(x: number, y: number, z: number, feed_rate: number, extruding: boolean);
    static new_complete(start_x: number, start_y: number, start_z: number, end_x: number, end_y: number, end_z: number, feed_rate: number, extruding: boolean, layer_height: number, is_perimeter: boolean): PositionData;
    readonly extruding: boolean;
    readonly feed_rate: number;
    readonly file_end_position: number;
    readonly file_position: number;
    readonly is_perimeter: boolean;
    readonly layer_height: number;
    readonly length: number;
    readonly line_number: number;
    readonly start_x: number;
    readonly start_y: number;
    readonly start_z: number;
    readonly tool: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export class ProcessingResult {
    free(): void;
    [Symbol.dispose](): void;
    has_error(): boolean;
    constructor(success: boolean, error_message: string, line_count: number, move_count: number, processing_time_ms: number);
    readonly error_message: string;
    readonly line_count: number;
    readonly move_count: number;
    readonly processing_time_ms: number;
    readonly success: boolean;
}

export class RenderBuffers {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    take_color_data(): Float32Array;
    take_feed_rate_data(): Float32Array;
    take_file_end_position_data(): Float32Array;
    take_file_position_data(): Float32Array;
    take_is_perimeter_data(): Float32Array;
    take_matrix_data(): Float32Array;
    take_pick_data(): Float32Array;
    take_tool_data(): Float32Array;
    readonly segment_count: number;
}

export function get_version(): string;

export function main(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_gcodeprocessor_free: (a: number, b: number) => void;
    readonly __wbg_positiondata_free: (a: number, b: number) => void;
    readonly __wbg_processingresult_free: (a: number, b: number) => void;
    readonly __wbg_renderbuffers_free: (a: number, b: number) => void;
    readonly gcodeprocessor_clear_data: (a: number) => void;
    readonly gcodeprocessor_generate_render_buffers: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly gcodeprocessor_get_position_buffer: (a: number) => [number, number];
    readonly gcodeprocessor_new: () => number;
    readonly gcodeprocessor_process_file: (a: number, b: number, c: number, d: number) => number;
    readonly gcodeprocessor_set_g1_as_extrusion: (a: number, b: number) => void;
    readonly gcodeprocessor_set_z_belt: (a: number, b: number, c: number) => void;
    readonly get_version: () => [number, number];
    readonly main: () => void;
    readonly positiondata_extruding: (a: number) => number;
    readonly positiondata_feed_rate: (a: number) => number;
    readonly positiondata_file_end_position: (a: number) => number;
    readonly positiondata_file_position: (a: number) => number;
    readonly positiondata_is_perimeter: (a: number) => number;
    readonly positiondata_layer_height: (a: number) => number;
    readonly positiondata_length: (a: number) => number;
    readonly positiondata_line_number: (a: number) => number;
    readonly positiondata_new: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly positiondata_new_complete: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly positiondata_start_x: (a: number) => number;
    readonly positiondata_start_y: (a: number) => number;
    readonly positiondata_start_z: (a: number) => number;
    readonly positiondata_tool: (a: number) => number;
    readonly positiondata_x: (a: number) => number;
    readonly positiondata_y: (a: number) => number;
    readonly positiondata_z: (a: number) => number;
    readonly processingresult_error_message: (a: number) => [number, number];
    readonly processingresult_has_error: (a: number) => number;
    readonly processingresult_line_count: (a: number) => number;
    readonly processingresult_move_count: (a: number) => number;
    readonly processingresult_new: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly processingresult_processing_time_ms: (a: number) => number;
    readonly processingresult_success: (a: number) => number;
    readonly renderbuffers_segment_count: (a: number) => number;
    readonly renderbuffers_take_color_data: (a: number) => [number, number];
    readonly renderbuffers_take_feed_rate_data: (a: number) => [number, number];
    readonly renderbuffers_take_file_end_position_data: (a: number) => [number, number];
    readonly renderbuffers_take_file_position_data: (a: number) => [number, number];
    readonly renderbuffers_take_is_perimeter_data: (a: number) => [number, number];
    readonly renderbuffers_take_matrix_data: (a: number) => [number, number];
    readonly renderbuffers_take_pick_data: (a: number) => [number, number];
    readonly renderbuffers_take_tool_data: (a: number) => [number, number];
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
