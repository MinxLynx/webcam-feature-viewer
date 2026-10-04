const agent = globalThis.navigator?.userAgent || '';
export const appleMobile = /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && globalThis.navigator?.maxTouchPoints > 1);

// Limit the three full-frame canvases on iOS, including very large photo inputs.
export function previewSize(width, height, bounded = appleMobile) {
  const scale = bounded ? Math.min(1, 2048 / Math.max(width, height)) : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function cameraConstraints(deviceId, facingMode, width) {
  return { audio: false, video: {
    ...(facingMode ? { facingMode: { ideal: facingMode } } : deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: width }, height: { ideal: Math.round(width * 9 / 16) }, frameRate: { ideal: 30, max: 30 },
  } };
}
