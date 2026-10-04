// Sparse pyramidal Lucas–Kanade tracking with a forward/backward check.
// This module is independent of the UI so its measurements can be tested.
function sample(image, x, y) {
  const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy, i=iy*image.width+ix;
  const a=image.data;
  return (a[i]*(1-fx)+a[i+1]*fx)*(1-fy)+(a[i+image.width]*(1-fx)+a[i+image.width+1]*fx)*fy;
}
function pyramid(gray,width,height) {
  const levels=[{data:gray.slice(),width,height}];
  while(levels.length<6 && Math.min(width,height)>=64) {
    const previous=levels.at(-1);width=Math.floor(width/2);height=Math.floor(height/2);
    const data=new Float32Array(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const i=2*y*previous.width+2*x,a=previous.data;
      data[y*width+x]=(a[i]+a[i+1]+a[i+previous.width]+a[i+previous.width+1])/4;
    }
    levels.push({data,width,height});
  }
  return levels;
}
const inside=(im,x,y,margin=5)=>x>=margin&&y>=margin&&x<im.width-margin-1&&y<im.height-margin-1;
function follow(previous,current,point,initial={x:0,y:0}) {
  let dx=initial.x/(2**previous.length),dy=initial.y/(2**previous.length),used=false;
  for(let level=previous.length-1;level>=0;level--) {
    const a=previous[level],b=current[level],scale=2**level;
    const x=(point.x+0.5)/scale-0.5,y=(point.y+0.5)/scale-0.5;
    dx*=2;dy*=2;
    if(!inside(a,x,y)) { if(level===0)return null;continue; }
    let xx=0,xy=0,yy=0;
    const patch=[];
    for(let v=-3;v<=3;v++)for(let u=-3;u<=3;u++) {
      const px=x+u,py=y+v;
      const gx=(sample(a,px+1,py)-sample(a,px-1,py))/2;
      const gy=(sample(a,px,py+1)-sample(a,px,py-1))/2;
      patch.push({u,v,gx,gy,value:sample(a,px,py)});xx+=gx*gx;xy+=gx*gy;yy+=gy*gy;
    }
    const determinant=xx*yy-xy*xy;
    if(determinant<1e-7) {if(level===0)return null;continue;}
    used=true;
    for(let iteration=0;iteration<20;iteration++) {
      if(!inside(b,x+dx,y+dy))return null;
      let bx=0,by=0;
      for(const p of patch){const error=p.value-sample(b,x+dx+p.u,y+dy+p.v);bx+=p.gx*error;by+=p.gy*error;}
      const ux=(yy*bx-xy*by)/determinant,uy=(xx*by-xy*bx)/determinant;
      if(!Number.isFinite(ux+uy)||Math.hypot(ux,uy)>5)return null;
      dx+=ux;dy+=uy;
      if(ux*ux+uy*uy<0.0004)break;
    }
    if(level===0) {
      if(!inside(b,x+dx,y+dy))return null;
      let residual=0;
      for(const p of patch)residual+=Math.abs(p.value-sample(b,x+dx+p.u,y+dy+p.v));
      if(residual/patch.length>0.09)return null;
    }
  }
  return used?{x:point.x+dx,y:point.y+dy}:null;
}
export function median(values) {
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b),mid=sorted.length>>1;
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}
export function summarizeMotion(tracks) {
  const matched=tracks.filter(t=>t.age>1);
  return {matched:matched.length,dx:median(matched.map(t=>t.dx)),dy:median(matched.map(t=>t.dy)),medianSpeed:median(matched.map(t=>Math.hypot(t.dx,t.dy)))};
}
class PointGrid {
  constructor(distance){this.distance=Math.max(1,distance);this.cells=new Map();}
  key(x,y){return `${x},${y}`;}
  add(p){const key=this.key(Math.floor(p.x/this.distance),Math.floor(p.y/this.distance));if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(p);}
  near(p){const x=Math.floor(p.x/this.distance),y=Math.floor(p.y/this.distance),d2=this.distance**2;for(let v=y-1;v<=y+1;v++)for(let u=x-1;u<=x+1;u++)if((this.cells.get(this.key(u,v))||[]).some(q=>(q.x-p.x)**2+(q.y-p.y)**2<d2))return true;return false;}
}
export class FeatureTracker {
  constructor(){this.reset();}
  reset(){this.previous=null;this.tracks=[];this.nextId=1;this.width=0;this.height=0;}
  update(gray,width,height,detected,{limit=detected.length||3000,minDistance=10,predict=true}={}) {
    if(width!==this.width||height!==this.height)this.reset();
    this.width=width;this.height=height;
    const current=pyramid(gray,width,height),tracks=[],grid=new PointGrid(Math.max(1.5,Math.min(3,minDistance*0.4)));
    if(this.previous)for(const track of this.tracks.slice(0,limit)) {
      const guess=predict?{x:track.dx,y:track.dy}:{x:0,y:0};
      let next=follow(this.previous,current,track,guess);
      if(!next&&predict&&(guess.x||guess.y))next=follow(this.previous,current,track);
      if(!next)continue;
      const back=follow(current,this.previous,next,{x:track.x-next.x,y:track.y-next.y});
      if(!back||Math.hypot(back.x-track.x,back.y-track.y)>1.25)continue;
      if(grid.near(next))continue;grid.add(next);
      tracks.push({...next,id:track.id,age:track.age+1,dx:next.x-track.x,dy:next.y-track.y,trail:[...track.trail.slice(-23),next]});
    }
    this.previous=current;this.tracks=tracks;
    this.addFeatures(detected,{limit,minDistance});
    return {tracks:this.tracks,motion:summarizeMotion(this.tracks)};
  }
  addFeatures(detected,{limit=3000,minDistance=5}={}) {
    if(!this.previous)return [];
    // Suppress only duplicates of continued tracks, not a second full-radius
    // thinning pass over already spaced detector results.
    const grid=new PointGrid(Math.max(1.5,Math.min(3,minDistance*0.4))),added=[];
    this.tracks.forEach(p=>grid.add(p));
    for(const p of detected){if(this.tracks.length>=limit)break;if(!inside(this.previous[0],p.x,p.y,4)||grid.near(p))continue;
      const t={id:this.nextId++,x:p.x,y:p.y,age:1,dx:0,dy:0,trail:[{x:p.x,y:p.y}]};this.tracks.push(t);added.push(t);grid.add(t);}
    return added;
  }
}
export function featureDensity(points,width,height,cols=16,rows=9) {
  const cells=new Array(cols*rows).fill(0);
  for(const p of points)if(p.x>=0&&p.y>=0&&p.x<width&&p.y<height)cells[Math.floor(p.y/height*rows)*cols+Math.floor(p.x/width*cols)]++;
  const occupied=cells.filter(n=>n>0).length;
  return {cols,rows,cells,peak:Math.max(0,...cells),occupied,coverage:occupied/cells.length};
}
