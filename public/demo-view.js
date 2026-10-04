export const techniques={
  points:{title:'特徴点を観察',description:'角や模様など、明るさが複数方向に変化する場所を検出します。',scene:'objects'},
  trails:{title:'01 / 特徴点の追跡',description:'同じ特徴点を追い、直近24解析フレームの軌跡を色付きで表示します。ゆっくり物を動かしてみてください。',scene:'objects'},
  flow:{title:'02 / オプティカルフロー',description:'特徴点の移動を矢印で表示します（長さ4倍）。数値は反転前の元映像での1解析フレーム間の変位です。',scene:'translation'},
  density:{title:'03 / 特徴点の密度',description:'16×9の区画に分け、特徴点の多い場所を暖色で表示します。模様と無地の領域を比べてみてください。',scene:'detail'},
  object:{title:'04 / 物体トラッキング・画像合成',description:'「範囲を選択」を押して物体を囲むと、その移動・回転・拡大縮小に画像が追従します。',scene:'objects'},
};
export function renderOverlay(ctx,frame,showPoints) {
  if(frame.technique==='object')return;
  const sx=frame.sourceWidth/frame.width,sy=frame.sourceHeight/frame.height;
  const unit=Math.max(1,frame.sourceWidth/960);
  const x=p=>(p.x+0.5)*sx,y=p=>(p.y+0.5)*sy;
  ctx.lineWidth=1.4*unit;
  if(frame.technique==='density'&&frame.density) {
    const {cols,rows,cells,peak}=frame.density,cw=frame.sourceWidth/cols,ch=frame.sourceHeight/rows;
    cells.forEach((count,i)=>{
      if(!count)return;
      const strength=count/peak;
      ctx.fillStyle=`hsla(${190-190*strength},90%,55%,${0.16+strength*0.52})`;
      ctx.fillRect((i%cols)*cw,Math.floor(i/cols)*ch,cw,ch);
    });
    ctx.strokeStyle='#c6e2eb33';ctx.lineWidth=unit*0.6;
    for(let i=1;i<cols;i++){ctx.beginPath();ctx.moveTo(i*cw,0);ctx.lineTo(i*cw,frame.sourceHeight);ctx.stroke();}
    for(let i=1;i<rows;i++){ctx.beginPath();ctx.moveTo(0,i*ch);ctx.lineTo(frame.sourceWidth,i*ch);ctx.stroke();}
  }
  if(showPoints&&['trails','flow'].includes(frame.technique)){
    // Newly detected corners stay visible even before motion correspondence exists.
    ctx.fillStyle='#7effc8';ctx.beginPath();for(const p of frame.points){ctx.moveTo(x(p)+1.8*unit,y(p));ctx.arc(x(p),y(p),1.8*unit,0,Math.PI*2);}ctx.fill();
  }
  if(['trails','flow'].includes(frame.technique))for(const track of frame.tracks) {
    ctx.strokeStyle=frame.technique==='trails'?`hsl(${track.id*137.5%360},90%,70%)`:'#ffd78a';
    ctx.fillStyle=ctx.strokeStyle;
    if(frame.technique==='trails') {
      ctx.beginPath();track.trail.forEach((p,i)=>i?ctx.lineTo(x(p),y(p)):ctx.moveTo(x(p),y(p)));ctx.stroke();
    } else if(track.age>1) {
      const from={x:track.x-track.dx,y:track.y-track.dy};
      const ex=x(from)+track.dx*sx*4,ey=y(from)+track.dy*sy*4;
      const angle=Math.atan2(track.dy*sy,track.dx*sx),length=Math.hypot(track.dx*sx*4,track.dy*sy*4);
      if(length>unit) {
        const head=Math.min(6*unit,length*0.5);
        ctx.beginPath();ctx.moveTo(x(from),y(from));ctx.lineTo(ex,ey);
        ctx.lineTo(ex-head*Math.cos(angle-0.5),ey-head*Math.sin(angle-0.5));ctx.moveTo(ex,ey);
        ctx.lineTo(ex-head*Math.cos(angle+0.5),ey-head*Math.sin(angle+0.5));ctx.stroke();
      }
    }
    if(showPoints){ctx.beginPath();ctx.arc(x(track),y(track),2.3*unit,0,Math.PI*2);ctx.fill();}
  }
  else if(showPoints) {
    ctx.fillStyle='#7effc8';ctx.strokeStyle='#072b24';ctx.lineWidth=unit;
    ctx.beginPath();for(const p of frame.points){ctx.moveTo(x(p)+2.5*unit,y(p));ctx.arc(x(p),y(p),2.5*unit,0,Math.PI*2);}ctx.fill();ctx.stroke();
  }
}
export function demoStats(frame) {
  if(frame.technique==='object'){
    if(frame.object?.status==='tracking')return `${frame.object.method==='appearance'?'画像照合で復帰':frame.object.method==='translation'?'少数点で移動を追跡':'追跡中'} · 対応 ${frame.object.inliers} 点 / 維持 ${frame.object.tracks.length} 点 · 補充 ${frame.object.replenished||0} 点 · 回転 ${(frame.object.transform.rotation*180/Math.PI).toFixed(1)}° · 拡大率 ${frame.object.transform.scale.toFixed(2)}×`;
    if(['lost','coasting'].includes(frame.object?.status))return frame.object.reason;
    return '物体の範囲を選ぶと画像を重ねられます。選択範囲には複数の角や模様を含めてください。';
  }
  if(frame.technique==='trails')return `検出 ${frame.points.length} 点 · 追跡 ${frame.tracks.length} 点 / 継続 ${frame.motion.matched} 点 · 上限 ${frame.options.maxPoints} 点・24フレームの軌跡`;
  if(frame.technique==='flow') {
    if(!frame.motion.matched)return `検出 ${frame.points.length} 点を表示中 · 移動の対応を探索中…`;
    const dx=frame.motion.dx*frame.sourceWidth/frame.width,dy=frame.motion.dy*frame.sourceHeight/frame.height;
    return `検出 ${frame.points.length} 点 · 対応 ${frame.motion.matched} 点 · 中央変位 x ${dx.toFixed(2)} / y ${dy.toFixed(2)} px · 矢印 ×4`;
  }
  if(frame.technique==='density')return `特徴点のある区画 ${(frame.density.coverage*100).toFixed(0)}% · 最大 ${frame.density.peak} 点/区画 · 寒色 → 暖色 = 疎 → 密`;
  return '緑の点 = 検出したコーナー';
}
// Draw vector scenes at the actual requested input size, including fine detail.
export function drawDemoScene(c,width,height,time,scene) {
  c.save();c.scale(width/960,height/540);
  c.fillStyle='#142630';c.fillRect(0,0,960,540);
  if(scene==='translation') {
    c.save();c.translate(Math.sin(time*0.0006)*65,Math.cos(time*0.0005)*40);
    for(let y=-1;y<12;y++)for(let x=-1;x<19;x++) {
      const seed=Math.abs((x*73+y*191+379)%101);
      c.fillStyle=`hsl(${155+seed},35%,${35+seed%40}%)`;
      c.fillRect(x*60+(seed%13),y*56,15+seed%27,12+seed%24);
      c.fillStyle='#142630';c.fillRect(x*60+(seed%13)+5,y*56+5,5,5);
    }
    c.restore();
  } else if(scene==='detail') {
    c.fillStyle='#1e343e';c.fillRect(35,35,270,470);
    for(let panel=0;panel<3;panel++) {
      const step=[24,10,4][panel],left=335+panel*200;
      for(let y=65;y<475;y+=step)for(let x=left;x<left+175;x+=step) {
        c.fillStyle=((Math.floor((x-left)/step)+Math.floor((y-65)/step))%2)?'#d4e6dd':'#31545c';
        c.fillRect(x,y,step,step);
      }
    }
    c.fillStyle='#cfad7c';c.fillRect(65,210,180,120);
  } else {
    c.strokeStyle='#26434e';c.lineWidth=1;
    for(let x=0;x<960;x+=40){c.beginPath();c.moveTo(x,0);c.lineTo(x,540);c.stroke();}
    for(let y=0;y<540;y+=40){c.beginPath();c.moveTo(0,y);c.lineTo(960,y);c.stroke();}
    c.save();c.translate(345+Math.sin(time*0.00045)*65,270);c.rotate(Math.sin(time*0.0003)*0.19);
    c.fillStyle='#e3cbaa';c.fillRect(-176,-176,352,352);
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){c.fillStyle=(x+y)%2?'#d9ebe3':'#284653';c.fillRect(-160+x*40,-160+y*40,40,40);}c.restore();
    c.save();c.translate(740,260+Math.sin(time*0.0007)*38);c.rotate(time*0.00012);
    c.fillStyle='#b6a1e4';c.fillRect(-90,-90,180,180);c.fillStyle='#273347';c.fillRect(-60,-60,120,120);
    c.fillStyle='#ebca7e';for(let y=-35;y<=35;y+=35)for(let x=-35;x<=35;x+=35)c.fillRect(x-9,y-9,18,18);c.restore();
  }
  c.restore();
}
