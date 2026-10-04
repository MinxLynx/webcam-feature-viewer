import test from 'node:test';
import assert from 'node:assert/strict';
import { FeatureTracker, featureDensity, median } from '../public/vision.js';
import { CornerDetector } from '../public/detector.js';

function texture(width,height,dx=0,dy=0) {
  const data=new Uint8ClampedArray(width*height*4);
  // A continuous textured field lets fractional translations have known truth.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const u=x-dx,v=y-dy;
    const value=128+40*Math.sin(u*0.13)*Math.cos(v*0.17)+32*Math.sin(u*0.07+v*0.11)+25*Math.cos(u*0.21-v*0.05);
    const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  return data;
}
for(const [dx,dy] of [[0,0],[3,-2],[2.4,-1.7],[9,6]])test(`optical flow recovers known translation (${dx}, ${dy})`,()=>{
  const tracker=new FeatureTracker(),detector=new CornerDetector(),w=256,h=192;
  let points=detector.detect(texture(w,h),w,h,{minDistance:12});
  tracker.update(detector.gray,w,h,points);
  points=detector.detect(texture(w,h,dx,dy),w,h,{minDistance:12});
  const result=tracker.update(detector.gray,w,h,points);
  const matched=result.tracks.filter(t=>t.age>1);
  assert(matched.length>=20,`only ${matched.length} tracks survived`);
  assert(Math.abs(result.motion.dx-dx)<0.3,`dx ${result.motion.dx}`);
  assert(Math.abs(result.motion.dy-dy)<0.3,`dy ${result.motion.dy}`);
  assert(median(matched.map(t=>Math.hypot(t.dx-dx,t.dy-dy)))<0.4);
  assert(matched.every(t=>t.trail.length===2));
});
test('lost features are discarded and resets do not retain old trajectories',()=>{
  const tracker=new FeatureTracker(),detector=new CornerDetector(),w=160,h=120;
  const points=detector.detect(texture(w,h),w,h);
  tracker.update(detector.gray,w,h,points);
  const lost=tracker.update(new Float32Array(w*h),w,h,[]);
  assert.equal(lost.tracks.length,0);assert.equal(lost.motion.matched,0);
  tracker.reset();const fresh=tracker.update(detector.gray,w,h,points);
  assert(fresh.tracks.every(t=>t.age===1&&t.trail.length===1));
  const resized=tracker.update(new Float32Array(80*60),80,60,[]);
  assert.equal(resized.tracks.length,0);
});
test('tracking has bounded history and track count',()=>{
  const tracker=new FeatureTracker(),detector=new CornerDetector(),w=160,h=120;
  const points=detector.detect(texture(w,h),w,h);
  let result;
  for(let i=0;i<30;i++)result=tracker.update(detector.gray,w,h,points,{limit:20});
  assert(result.tracks.length<=20);assert(result.tracks.some(t=>t.age>=25));
  assert(result.tracks.every(t=>t.trail.length<=24));
});
test('density bins conserve points, handle boundaries, and report empty input',()=>{
  const result=featureDensity([{x:0,y:0},{x:9,y:9},{x:10,y:0},{x:39.9,y:19.9}],40,20,4,2);
  assert.equal(result.cells.reduce((a,b)=>a+b,0),4);assert.equal(result.cells[0],2);assert.equal(result.cells[1],1);assert.equal(result.cells[7],1);
  assert.equal(result.peak,2);assert.equal(result.coverage,3/8);
  assert.equal(featureDensity([],1920,1080).peak,0);
});
test('full-HD detector returns genuine full-resolution coordinates',()=>{
  const w=1920,h=1080,data=new Uint8ClampedArray(w*h*4);
  for(let y=500;y<550;y++)for(let x=1600;x<1660;x++){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=255;data[i+3]=255;}
  const points=new CornerDetector().detect(data,w,h);
  assert.equal(points.length,4);assert(points.every(p=>p.x>1500&&p.y>450));
});
test('tracking honors a 1000-point limit and replenishes beyond the former 250-point cap',()=>{
  const w=480,h=360,detector=new CornerDetector(),tracker=new FeatureTracker();
  const data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=((x/10|0)+(y/10|0))%2?240:20;data[i+3]=255;}
  const points=detector.detect(data,w,h,{maxPoints:1000,minDistance:5});assert.equal(points.length,1000);
  let result=tracker.update(detector.gray,w,h,points,{limit:1000,minDistance:5});assert.equal(result.tracks.length,1000);
  tracker.tracks=tracker.tracks.slice(0,50);
  result=tracker.update(detector.gray,w,h,points,{limit:1000,minDistance:5});assert(result.tracks.length>=980);assert(result.motion.matched>=45);
  result=tracker.update(detector.gray,w,h,points,{limit:100,minDistance:5});assert.equal(result.tracks.length,100);
});
