function sample(data,width,x,y){const u=Math.floor(x),v=Math.floor(y),fx=x-u,fy=y-v,i=v*width+u;return (data[i]*(1-fx)+data[i+1]*fx)*(1-fy)+(data[i+width]*(1-fx)+data[i+width+1]*fx)*fy;}
function shrink(gray,width,height,factor){if(factor===1)return {data:gray,width,height};const w=Math.floor(width/factor),h=Math.floor(height/factor),data=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let sum=0;for(let v=0;v<factor;v++)for(let u=0;u<factor;u++)sum+=gray[(y*factor+v)*width+x*factor+u];data[y*w+x]=sum/(factor*factor);}return {data,width:w,height:h};}
// An immutable appearance reference complements short-range optical flow.
// Search uses a bounded-resolution image; source coordinates stay unchanged.
export class AppearanceMatcher {
  constructor(gray,width,height,roi){
    this.factor=Math.max(1,Math.ceil(Math.max(width,height)/640));this.roi=roi;
    const im=shrink(gray,width,height,this.factor);this.reference=im;this.samples=[];
    for(let y=0;y<13;y++)for(let x=0;x<13;x++){
      const px=roi.x+roi.width*(x+0.35+((x*17+y*7)%9)/30)/13,py=roi.y+roi.height*(y+0.35+((x*5+y*11)%9)/30)/13;
      const u=(px+0.5)/this.factor-0.5,v=(py+0.5)/this.factor-0.5;
      if(u<0||v<0||u>=im.width-1||v>=im.height-1)continue;
      this.samples.push({x:px/this.factor,y:py/this.factor,value:sample(im.data,im.width,u,v)});
    }
  }
  prepare(gray,width,height){this.image=shrink(gray,width,height,this.factor);}
  score(model,coarse=false){
    const im=this.image,f=this.factor;let n=0,sa=0,sb=0,saa=0,sbb=0,sab=0;const errors=[];
    for(let i=0;i<this.samples.length;i+=coarse?3:1){const p=this.samples[i],x=model.a*p.x-model.b*p.y+model.tx/f+0.5/f-0.5,y=model.b*p.x+model.a*p.y+model.ty/f+0.5/f-0.5;
      if(x<0||y<0||x>=im.width-1||y>=im.height-1)continue;
      const a=p.value,b=sample(im.data,im.width,x,y);n++;sa+=a;sb+=b;saa+=a*a;sbb+=b*b;sab+=a*b;if(!coarse)errors.push(Math.abs(a-b));
    }
    const count=Math.ceil(this.samples.length/(coarse?3:1));
    const denominator=Math.sqrt(Math.max(0,(n*saa-sa*sa)*(n*sbb-sb*sb)));
    if(n<count*0.65||denominator<1e-5)return {correlation:-1,error:1};
    if(coarse)return {correlation:(n*sab-sa*sb)/denominator,error:0};
    errors.sort((a,b)=>a-b);const kept=Math.max(1,Math.floor(errors.length*0.7));
    return {correlation:(n*sab-sa*sb)/denominator,error:errors.slice(0,kept).reduce((a,b)=>a+b,0)/kept};
  }
  search(prior){
    const f=this.factor,im=this.image,r=this.roi,cx=r.x+r.width/2,cy=r.y+r.height/2;
    const rotation=Math.atan2(prior.b,prior.a),scale=Math.hypot(prior.a,prior.b);
    const step=Math.max(2,Math.min(7,Math.min(r.width,r.height)/f/16))*f;
    const shapes=[[rotation,scale],[rotation-0.18,scale],[rotation+0.18,scale],[rotation-0.35,scale],[rotation+0.35,scale],[rotation,scale*0.85],[rotation,scale*1.18]];
    const peaks=[];
    const consider=m=>{const score=this.score(m,true).correlation;if(score<0.42)return;peaks.push({...m,score});peaks.sort((a,b)=>b.score-a.score);if(peaks.length>16)peaks.length=16;};
    for(const [angle,size] of shapes){const a=size*Math.cos(angle),b=size*Math.sin(angle);
      for(let y=0;y<im.height*f;y+=step)for(let x=0;x<im.width*f;x+=step)consider({a,b,tx:x-a*cx+b*cy,ty:y-b*cx-a*cy});}
    if(!peaks.length)return null;
    const refined=[];
    for(const peak of peaks){let best={...peak,score:this.score(peak).correlation};
      for(let stride=step/2;stride>=0.24*f;stride/=2){let winner=best;for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){const m={...best,tx:best.tx+x*stride,ty:best.ty+y*stride},score=this.score(m).correlation;if(score>winner.score)winner={...m,score};}best=winner;}
      for(const delta of [0.07,0.035,0.0175]){
        const centerX=best.a*cx-best.b*cy+best.tx,centerY=best.b*cx+best.a*cy+best.ty,angle=Math.atan2(best.b,best.a),size=Math.hypot(best.a,best.b);let winner=best;
        for(const da of [-delta,0,delta])for(const ds of [-delta,0,delta]){const a=size*(1+ds)*Math.cos(angle+da),b=size*(1+ds)*Math.sin(angle+da),m={a,b,tx:centerX-a*cx+b*cy,ty:centerY-b*cx-a*cy},score=this.score(m).correlation;if(score>winner.score)winner={...m,score};}best=winner;
        for(const stride of [f,0.5*f]){let winner=best;for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){const m={...best,tx:best.tx+x*stride,ty:best.ty+y*stride},score=this.score(m).correlation;if(score>winner.score)winner={...m,score};}best=winner;}
      }
      refined.push(best);
    }
    refined.sort((a,b)=>b.score-a.score);const best=refined[0];
    const rival=refined.find(p=>Math.hypot(p.tx-best.tx,p.ty-best.ty)>Math.max(8*f,Math.min(r.width,r.height)*0.25));
    if(best.score<0.86||(rival&&best.score-rival.score<0.035)||this.score(best).error>0.13)return null;
    return {...best,scale:Math.hypot(best.a,best.b),rotation:Math.atan2(best.b,best.a)};
  }
}
