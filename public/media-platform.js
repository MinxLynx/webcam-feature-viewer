const agent = globalThis.navigator?.userAgent || '';
export const appleMobile = /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && globalThis.navigator?.maxTouchPoints > 1);

// Limit the three full-frame canvases on iOS, including very large photo inputs.
export function previewSize(width, height, bounded = appleMobile) {
  const scale = bounded ? Math.min(1, 2048 / Math.max(width, height)) : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Preserve the target cadence across jittery display callbacks.
export class FramePacer {
  reset(){this.next=0;this.rate=0;}
  ready(now,rate=60){
    const interval=1000/rate;
    if(this.rate!==rate){this.next=0;this.rate=rate;}
    if(now+0.5<this.next)return false;
    this.next=this.next?this.next+interval:now+interval;
    if(this.next<=now)this.next=now+interval;
    return true;
  }
}

export function cameraConstraints(deviceId, facingMode, width, frameRate=60) {
  return { audio: false, video: {
    ...(facingMode ? { facingMode: { ideal: facingMode } } : deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: width }, height: { ideal: Math.round(width * 9 / 16) }, frameRate: { ideal: frameRate, max: frameRate },
  } };
}
