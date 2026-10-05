import { CornerDetector } from './detector.js';
import { FeatureTracker, featureDensity } from './vision.js';
import { ObjectTracker, transformPoint } from './object-tracker.js';
const detector = new CornerDetector();
const tracker = new FeatureTracker();
const objectTracker = new ObjectTracker();
let previousKey='',previousTime=0;
self.onmessage = ({ data }) => {
  const started = performance.now();
  try {
    const allPoints = detector.detect(new Uint8ClampedArray(data.buffer), data.width, data.height, {...data.options,maxPoints:data.technique==='object'?Math.max(2000,data.options.maxPoints):data.options.maxPoints});
    const points=allPoints.slice(0,data.options.maxPoints);
    let tracking={tracks:[],motion:{matched:0,dx:0,dy:0,medianSpeed:0}};
    const key=[data.generation,data.epoch,data.width,data.height,data.technique,data.options.algorithm].join(':');
    if(key!==previousKey){tracker.reset();objectTracker.clear();}
    else if(data.timestamp-previousTime>500)tracker.reset();
    previousKey=key;previousTime=data.timestamp;
    if(['trails','flow'].includes(data.technique))tracking=tracker.update(detector.gray,data.width,data.height,points,{limit:data.options.maxPoints,minDistance:data.options.minDistance});
    else tracker.reset();
    const density=data.technique==='density'?featureDensity(points,data.width,data.height):null;
    let objectPoints=allPoints;
    if(data.technique==='object'&&data.selection){
      const s=data.selection;let region={x:s.x*data.width,y:s.y*data.height,width:s.width*data.width,height:s.height*data.height};
      if(objectTracker.selectionId===s.id&&objectTracker.model&&objectTracker.roi){const r=objectTracker.roi,m=objectTracker.model,corners=[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x,y:r.y+r.height},{x:r.x+r.width,y:r.y+r.height}].map(p=>transformPoint(m,p));const x=Math.min(...corners.map(p=>p.x)),y=Math.min(...corners.map(p=>p.y));region={x:x-8,y:y-8,width:Math.max(...corners.map(p=>p.x))-x+16,height:Math.max(...corners.map(p=>p.y))-y+16};}
      const local=detector.select({...data.options,quality:Math.min(0.003,data.options.quality),minDistance:Math.min(4,data.options.minDistance),maxPoints:400,region});
      objectPoints=[...local,...allPoints];
    }
    const object=data.technique==='object'?objectTracker.update(detector.gray,data.width,data.height,objectPoints,data.selection,{timestamp:data.timestamp}):null;
    self.postMessage({ id: data.id, points, ...tracking, density, object, duration: performance.now()-started });
  } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
