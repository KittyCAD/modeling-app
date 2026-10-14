export const LOCAL_WEBGPU_GTAO_USE_NORMAL_MRT = true
export const LOCAL_WEBGPU_GTAO_USE_DENOISE = true
export const LOCAL_WEBGPU_GTAO_SAMPLES = 16
export const LOCAL_WEBGPU_EDGE_LINE_WIDTH_PX = 2
export const LOCAL_WEBGPU_SKETCH_LINE_WIDTH_PX = 2
// Path tracing cost grows with the pixel count, so high-DPI screens are traced
// at this pixel ratio and scaled up.
export const LOCAL_WEBGPU_PATH_TRACE_PIXEL_RATIO = 1
// The denoiser runs once every pixel has this many samples.
export const LOCAL_WEBGPU_PATH_TRACE_DENOISED_SAMPLES = 16
export const LOCAL_WEBGPU_PATH_TRACE_SAMPLES = 256
