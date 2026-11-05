// Path tracing cost grows with the pixel count, so high-DPI screens are traced
// at this pixel ratio and scaled up.
export const LOCAL_WEBGPU_PATH_TRACE_PIXEL_RATIO = 1
// The denoiser runs once every pixel has this many samples.
export const LOCAL_WEBGPU_PATH_TRACE_DENOISED_SAMPLES = 16
export const LOCAL_WEBGPU_PATH_TRACE_SAMPLES = 256
