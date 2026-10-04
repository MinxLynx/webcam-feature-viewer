import { FeatureTracker } from './vision.js';
import { AppearanceMatcher } from './appearance.js';

export const transformPoint=(m,p)=>({x:m.a*p.x-m.b*p.y+m.tx,y:m.b*p.x+m.a*p.y+m.ty});
function fit(pairs) {
  let px=0,py=0,qx=0,qy=0;
  for(const {from,to} of pairs){px+=from.x;py+=from.y;qx+=to.x;qy+=to.y;}
  px/=pairs.length;py/=pairs.length;qx/=pairs.length;qy/=pairs.length;
  let denominator=0,a=0,b=0;
  for(const {from,to} of pairs){const x=from.x-px,y=from.y-py,u=to.x-qx,v=to.y-qy;denominator+=x*x+y*y;a+=x*u+y*v;b+=x*v-y*u;}
  if(denominator<1e-5)return null;
  a/=denominator;b/=denominator;
  return {a,b,tx:qx-a*px+b*py,ty:qy-b*px-a*py};
}
export function robustSimilarity(pairs,threshold=2.5,minSupport=Math.min(3,pairs.length)) {
  if(pairs.length<2)return null;
  minSupport=Math.max(2,minSupport);
  let best=[];let random=2166136261;
  const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random%pairs.length;};
  for(let trial=0;trial<160;trial++) {
    const i=next(),j=next();if(i===j)continue;
    if(Math.hypot(pairs[i].from.x-pairs[j].from.x,pairs[i].from.y-pairs[j].from.y)<4)continue;
    const model=fit([pairs[i],pairs[j]]);if(!model)continue;
    const inliers=pairs.filter(p=>{const q=transformPoint(model,p.from);return Math.hypot(q.x-p.to.x,q.y-p.to.y)<threshold;});
    if(inliers.length>best.length)best=inliers;
  }
  if(best.length<minSupport||best.length/pairs.length<0.55)return null;
  let model=fit(best);
  best=pairs.filter(p=>{const q=transformPoint(model,p.from);return Math.hypot(q.x-p.to.x,q.y-p.to.y)<threshold;});
  if(best.length<minSupport||best.length/pairs.length<0.55)return null;
  model=fit(best);
  const scale=Math.hypot(model.a,model.b);
  if(!Number.isFinite(scale)||scale<0.2||scale>5)return null;
  return {...model,inliers:best.length,inlierIds:best.map(p=>p.id),scale,rotation:Math.atan2(model.b,model.a)};
}
export class ObjectTracker {
  constructor(){this.clear();}
  clear(){this.tracker=new FeatureTracker();this.selectionId=null;this.anchors=new Map();this.state={status:'unselected'};this.matcher=null;this.misses=0;this.clock=0;this.velocity={x:0,y:0};}
  candidates(points,model){
    const determinant=model.a**2+model.b**2,r=this.roi;
    return points.filter(p=>{const x=(model.a*(p.x-model.tx)+model.b*(p.y-model.ty))/determinant,y=(-model.b*(p.x-model.tx)+model.a*(p.y-model.ty))/determinant;return x>=r.x+1&&x<=r.x+r.width-1&&y>=r.y+1&&y<=r.y+r.height-1;});
  }
  anchor(tracks,model){
    const determinant=model.a**2+model.b**2;
    for(const p of tracks)this.anchors.set(p.id,{x:(model.a*(p.x-model.tx)+model.b*(p.y-model.ty))/determinant,y:(-model.b*(p.x-model.tx)+model.a*(p.y-model.ty))/determinant});
  }
  update(gray,width,height,points,selection,{timestamp}={}) {
    if(!selection){this.clear();return this.state;}
    if(selection.id!==this.selectionId) {
      this.clear();this.selectionId=selection.id;this.width=width;this.height=height;
      const roi={x:selection.x*width-0.5,y:selection.y*height-0.5,width:selection.width*width,height:selection.height*height};
      const seeds=points.filter(p=>p.x>=roi.x&&p.x<=roi.x+roi.width&&p.y>=roi.y&&p.y<=roi.y+roi.height);
      const {tracks}=this.tracker.update(gray,width,height,seeds,{limit:200,minDistance:5});
      if(tracks.length<2){this.state={status:'lost',reason:'開始には離れた特徴点が2点以上必要です。模様を含む範囲を選び直してください。'};return this.state;}
      for(const t of tracks)this.anchors.set(t.id,{x:t.x,y:t.y});
      this.roi=roi;this.initialCount=tracks.length;
      this.matcher=new AppearanceMatcher(gray,width,height,roi);this.model={a:1,b:0,tx:0,ty:0,scale:1,rotation:0};
      this.clock=timestamp??0;this.confirmedTime=this.clock;
      this.state={status:'tracking',roi,transform:this.model,inliers:tracks.length,initialCount:tracks.length,tracks,method:'features',replenished:0};
      return this.state;
    }
    if(!this.matcher)return this.state;
    if(width!==this.width||height!==this.height)return this.lose('解析サイズが変わりました。範囲を選び直してください。');
    this.clock=timestamp??this.clock+33;this.matcher.prepare(gray,width,height);
    let tracks=[],model=null,method='features',replenished=0;
    if(this.state.status==='tracking'){
      tracks=this.tracker.update(gray,width,height,[],{limit:200,minDistance:5}).tracks;
      const pairs=tracks.filter(t=>this.anchors.has(t.id)).map(t=>({id:t.id,from:this.anchors.get(t.id),to:t}));
      model=robustSimilarity(pairs);
      // A single surviving feature can constrain translation, but cannot
      // determine new rotation or scale. Appearance must independently agree.
      if(!model&&pairs.length===1){const p=pairs[0],m=this.model;model={...m,tx:p.to.x-m.a*p.from.x+m.b*p.from.y,ty:p.to.y-m.b*p.from.x-m.a*p.from.y,inliers:1,inlierIds:[p.id]};method='translation';}
      if(model){const appearance=this.matcher.score(model);if(appearance.correlation<(model.inliers>=6?0.40:0.78)||appearance.error>0.16)model=null;}
    }
    if(!model&&(this.misses<2||this.misses%3===0)){
      const recovered=this.matcher.search(this.model);
      if(recovered){model={...recovered,inliers:0,inlierIds:[]};method='appearance';this.tracker.reset();this.anchors.clear();tracks=this.tracker.update(gray,width,height,this.candidates(points,model),{limit:200,minDistance:5}).tracks;this.anchor(tracks,model);model.inliers=tracks.length;model.inlierIds=tracks.map(t=>t.id);}
    }
    if(!model){
      this.misses++;this.tracker.reset();
      if(this.misses<=8&&this.clock-this.confirmedTime<=300){const transform={...this.model,tx:this.model.tx+this.velocity.x*Math.min(2,this.misses),ty:this.model.ty+this.velocity.y*Math.min(2,this.misses)};this.state={status:'coasting',roi:this.roi,transform,inliers:0,initialCount:this.initialCount,tracks:[],method:'prediction',reason:'一時的に見失いました。推定位置を表示しながら再探索しています。'};}
      else this.state={status:'lost',reason:'対象を自動再探索しています。戻らない場合は範囲を選び直してください。'};
      return this.state;
    }
    const ids=new Set(model.inlierIds);this.tracker.tracks=tracks.filter(t=>ids.has(t.id));
    // Only replenish inside a region whose motion and reference appearance agree.
    const additions=this.tracker.addFeatures(this.candidates(points,model),{limit:200,minDistance:5});this.anchor(additions,model);replenished=additions.length;
    const liveIds=new Set(this.tracker.tracks.map(t=>t.id));for(const id of this.anchors.keys())if(!liveIds.has(id))this.anchors.delete(id);
    this.velocity={x:Math.max(-30,Math.min(30,model.tx-this.model.tx)),y:Math.max(-30,Math.min(30,model.ty-this.model.ty))};
    this.model=model;this.confirmedTime=this.clock;this.misses=0;
    this.state={status:'tracking',roi:this.roi,transform:model,inliers:model.inliers,initialCount:this.initialCount,tracks:this.tracker.tracks,method,replenished};
    return this.state;
  }
  lose(reason){this.tracker.reset();this.matcher=null;this.state={status:'lost',reason};return this.state;}
}

// Object-fit: contain geometry, including mirrored previews and letterboxing.
export function previewPoint(clientX,clientY,rect,width,height,mirror,clamp=false) {
  const scale=Math.min(rect.width/width,rect.height/height),w=width*scale,h=height*scale;
  let x=(clientX-rect.left-(rect.width-w)/2)/w,y=(clientY-rect.top-(rect.height-h)/2)/h;
  if(!clamp&&(x<0||x>1||y<0||y>1))return null;
  x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));
  return {x:mirror?1-x:x,y};
}
