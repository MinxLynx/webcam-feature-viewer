import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectTracker, robustSimilarity, transformPoint, previewPoint } from '../public/object-tracker.js';
import { CornerDetector } from '../public/detector.js';

test('robust similarity recovers translation, rotation and scale despite outliers',()=>{
  const expected={a:1.2*Math.cos(0.25),b:1.2*Math.sin(0.25),tx:17,ty:-11};
  const pairs=Array.from({length:45},(_,id)=>{const from={x:20+(id%9)*20,y:30+Math.floor(id/9)*23};return {id,from,to:id<12?{x:id*7,y:200-id*3}:transformPoint(expected,from)};});
  const actual=robustSimilarity(pairs);assert(actual);assert.equal(actual.inliers,33);
  for(const field of ['a','b','tx','ty'])assert(Math.abs(actual[field]-expected[field])<1e-8);
});
test('degenerate and insufficient correspondences do not produce a transform',()=>{
  assert.equal(robustSimilarity([]),null);
  assert.equal(robustSimilarity(Array.from({length:12},(_,id)=>({id,from:{x:0,y:0},to:{x:id,y:id}}))),null);
});
function texture(width,height,m={a:1,b:0,tx:0,ty:0}) {
  const data=new Uint8ClampedArray(width*height*4),det=m.a*m.a+m.b*m.b;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=(m.a*(x-m.tx)+m.b*(y-m.ty))/det,v=(-m.b*(x-m.tx)+m.a*(y-m.ty))/det;
    const value=128+40*Math.sin(u*0.13)*Math.cos(v*0.17)+32*Math.sin(u*0.07+v*0.11)+25*Math.cos(u*0.21-v*0.05);
    const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }return data;
}
test('selected object follows motion, briefly holds during occlusion, and reacquires automatically',()=>{
  const w=256,h=192,tracker=new ObjectTracker(),detector=new CornerDetector(),selection={id:1,x:0.15,y:0.15,width:0.7,height:0.7};
  let points=detector.detect(texture(w,h),w,h,{minDistance:8});
  let state=tracker.update(detector.gray,w,h,points,selection);assert.equal(state.status,'tracking');
  const expected={a:1.02*Math.cos(0.025),b:1.02*Math.sin(0.025),tx:3,ty:-2};
  points=detector.detect(texture(w,h,expected),w,h,{minDistance:8});state=tracker.update(detector.gray,w,h,points,selection);
  assert.equal(state.status,'tracking');assert(state.inliers>=10);
  assert(Math.abs(state.transform.tx-expected.tx)<0.6);assert(Math.abs(state.transform.ty-expected.ty)<0.6);
  assert(Math.abs(state.transform.scale-1.02)<0.01);
  state=tracker.update(new Float32Array(w*h),w,h,[],selection);assert.equal(state.status,'coasting');assert(state.transform);
  for(let i=0;i<10;i++)state=tracker.update(new Float32Array(w*h),w,h,[],selection);
  assert.equal(state.status,'lost');assert.equal(state.transform,undefined);
  for(let i=0;i<4&&state.status!=='tracking';i++)state=tracker.update(detector.gray,w,h,points,selection);
  assert.equal(state.status,'tracking');assert.equal(state.method,'appearance');
  state=tracker.update(detector.gray,w,h,points,{...selection,id:2});assert.equal(state.status,'tracking');
});
test('flat selected regions cannot activate an overlay',()=>{
  const state=new ObjectTracker().update(new Float32Array(100*100),100,100,[],{id:1,x:0.1,y:0.1,width:0.8,height:0.8});
  assert.equal(state.status,'lost');
});
test('pointer coordinates respect portrait letterboxing and horizontal mirroring',()=>{
  const rect={left:10,top:20,width:800,height:450};
  assert.equal(previewPoint(20,100,rect,600,900,false),null);
  const p=previewPoint(335,245,rect,600,900,false);assert(Math.abs(p.x-0.25)<1e-9);assert.equal(p.y,0.5);
  assert.equal(previewPoint(335,245,rect,600,900,true).x,0.75);
  assert.equal(previewPoint(1000,245,rect,600,900,false,true).x,1);
});
test('two separated corners can initialize and sustain object tracking',()=>{
  const w=256,h=192,detector=new CornerDetector(),tracker=new ObjectTracker(),selection={id:1,x:0.1,y:0.1,width:0.8,height:0.8};
  const points=detector.detect(texture(w,h),w,h,{minDistance:10}).filter(p=>p.x>30&&p.x<220&&p.y>30&&p.y<160);
  const sparse=[points[0],points.find(p=>Math.hypot(p.x-points[0].x,p.y-points[0].y)>60)];
  assert(sparse[1]);assert.equal(tracker.update(detector.gray,w,h,sparse,selection).status,'tracking');
  detector.detect(texture(w,h,{a:1,b:0,tx:4,ty:-3}),w,h);
  const state=tracker.update(detector.gray,w,h,[],selection);
  assert.equal(state.status,'tracking');assert(Math.abs(state.transform.tx-4)<0.5);assert(Math.abs(state.transform.ty+3)<0.5);
});
test('validated surviving tracks replenish newly detected features',()=>{
  const w=256,h=192,detector=new CornerDetector(),tracker=new ObjectTracker(),selection={id:1,x:0.1,y:0.1,width:0.8,height:0.8};
  let points=detector.detect(texture(w,h),w,h,{minDistance:8});tracker.update(detector.gray,w,h,points.slice(0,15),selection);
  const initial=tracker.state.tracks.length;assert(initial>=2);
  points=detector.detect(texture(w,h,{a:1,b:0,tx:3,ty:2}),w,h,{minDistance:8});
  const state=tracker.update(detector.gray,w,h,points,selection);
  assert.equal(state.status,'tracking');assert(state.replenished>10);assert(state.tracks.length>initial);
  assert.equal(tracker.anchors.size,state.tracks.length);
});
function movingPatch(w,h,dx=0,dy=0,visible=true){
  const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){data[i*4]=data[i*4+1]=data[i*4+2]=24;data[i*4+3]=255;}
  if(visible)for(let y=0;y<72;y++)for(let x=0;x<96;x++){
    const px=40+dx+x,py=60+dy+y;if(px<0||py<0||px>=w||py>=h)continue;
    const seed=((x/8|0)*7919+(y/8|0)*104729+((x/8|0)*(y/8|0))*3571)%211;
    const i=(py*w+px)*4,value=40+seed;data[i]=data[i+1]=data[i+2]=value;
  }return data;
}
test('appearance search recovers a 76-pixel jump and reacquires after complete disappearance',()=>{
  const w=320,h=240,tracker=new ObjectTracker(),detector=new CornerDetector(),selection={id:1,x:40/w,y:60/h,width:96/w,height:72/h};
  let points=detector.detect(movingPatch(w,h),w,h,{minDistance:5});tracker.update(detector.gray,w,h,points,selection);
  points=detector.detect(movingPatch(w,h,70,30),w,h,{minDistance:5});let state=tracker.update(detector.gray,w,h,points,selection);
  assert.equal(state.status,'tracking');assert(Math.abs(state.transform.tx-70)<1.5,`tx ${state.transform.tx}`);assert(Math.abs(state.transform.ty-30)<1.5);
  points=detector.detect(movingPatch(w,h,0,0,false),w,h,{minDistance:5});
  for(let i=0;i<12;i++)state=tracker.update(detector.gray,w,h,points,selection);
  assert.equal(state.status,'lost');
  points=detector.detect(movingPatch(w,h,110,-25),w,h,{minDistance:5});
  for(let i=0;i<4&&state.status!=='tracking';i++)state=tracker.update(detector.gray,w,h,points,selection);
  assert.equal(state.status,'tracking');assert(Math.abs(state.transform.tx-110)<1.5);assert(Math.abs(state.transform.ty+25)<1.5);
});
