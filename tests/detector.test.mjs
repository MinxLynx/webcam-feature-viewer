import test from 'node:test';
import assert from 'node:assert/strict';
import { CornerDetector } from '../public/detector.js';

function image(width,height,pixel) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=pixel(x,y);data[i+3]=255;
  }
  return data;
}
for(const algorithm of ['shi-tomasi','harris']) {
  test(`${algorithm}: flat images and straight edges contain no corners`,()=>{
    const detector=new CornerDetector();
    for(const pixel of [()=>0,()=>128,()=>255,(x)=>x<40?0:255])assert.deepEqual(detector.detect(image(80,60,pixel),80,60,{algorithm}),[]);
  });
  test(`${algorithm}: finds the four corners of a rectangle`,()=>{
    const points=new CornerDetector().detect(image(100,80,(x,y)=>x>=20&&x<80&&y>=20&&y<60?255:0),100,80,{algorithm,minDistance:10});
    assert.equal(points.length,4);
    for(const [x,y] of [[20,20],[79,20],[20,59],[79,59]])assert(points.some(p=>Math.hypot(p.x-x,p.y-y)<4));
  });
  test(`${algorithm}: point limit, separation, and sensitivity`,()=>{
    const detector=new CornerDetector(),data=image(160,120,(x,y)=>((x/12|0)+(y/12|0))%2?230:20);
    const points=detector.detect(data,160,120,{algorithm,maxPoints:30,minDistance:15});
    assert.equal(points.length,30);
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)assert(Math.hypot(points[i].x-points[j].x,points[i].y-points[j].y)>=15);
    const varied=image(160,120,(x,y)=>((x/12|0)+(y/12|0))%2?(x<80?255:90):20);
    const low=detector.detect(varied,160,120,{algorithm,quality:0.2,maxPoints:1000,minDistance:5});
    const high=detector.detect(varied,160,120,{algorithm,quality:0.001,maxPoints:1000,minDistance:5});
    assert(high.length>low.length);
  });
}
test('detector handles image size changes without stale results',()=>{
  const detector=new CornerDetector();
  detector.detect(image(100,80,(x,y)=>x>30&&y>30?255:0),100,80);
  assert.deepEqual(detector.detect(image(60,50,()=>90),60,50),[]);
});
