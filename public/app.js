import { techniques, renderOverlay, demoStats, drawDemoScene } from './demo-view.js';
import { openLocalMedia, resolveDuration, mediaBlob, mediaError } from './local-media.js';
import { previewPoint } from './object-tracker.js';
import { appleMobile, previewSize, cameraConstraints, FramePacer } from './media-platform.js';
import { startOfflineSupport } from './pwa.js';
const $ = id => document.getElementById(id);
const video = $('video'), preview = $('preview'), ctx = preview.getContext('2d');
let capture = document.createElement('canvas'), captureCtx = capture.getContext('2d');
const analysis = document.createElement('canvas'), analysisCtx = analysis.getContext('2d', { willReadFrequently: true });
let stream = null, mode = 'idle', generation = 0, sequence = 0, pending = null, worker = null;
let animation = 0, fps = 0, frame = null;
let technique = 'points', epoch = 0, resultTimes = [];
let localInput=null,dirty=true,lastMediaTime=-1,demoTime=0,lastTick=0;
let selection=null,selectionId=0,selecting=false,drag=null,seedNext=false,resumeAfterSeed=false;
let overlayLoadId=0;
let preparedFile=null;
const pacer=new FramePacer();
let frameMedia=null,videoCallback=null,sourceFrame=0,lastSourceFrame=-1,lastVideoUI=0,lastMetrics=0;
let filePickerOpen=false,pickerVideo=null,resumePickerVideo=false;
function closeFilePicker(resume=true){
  filePickerOpen=false;
  if(resume&&resumePickerVideo&&pickerVideo===localInput?.element)pickerVideo.play().catch(()=>status('再生ボタンで動画を再開してください。'));
  pickerVideo=null;resumePickerVideo=false;
}
for(const id of ['sourceFile','originalFile','overlayFile']){
  $(id).addEventListener('click',()=>{
    filePickerOpen=true;pickerVideo=mode==='file-video'?localInput?.element:null;
    resumePickerVideo=!!pickerVideo&&!pickerVideo.paused;
    if(resumePickerVideo)pickerVideo.pause();
  });
  $(id).addEventListener('cancel',()=>closeFilePicker());
}
window.addEventListener('focus',()=>{if(filePickerOpen)closeFilePicker();});
function watchFrames(media){
  frameMedia=media;sourceFrame=0;lastSourceFrame=-1;
  if(!media.requestVideoFrameCallback)return;
  const next=()=>{if(frameMedia!==media)return;sourceFrame++;videoCallback=media.requestVideoFrameCallback(next);};
  videoCallback=media.requestVideoFrameCallback(next);
}
const defaultOverlay=document.createElement('canvas');defaultOverlay.width=360;defaultOverlay.height=220;
const badge=defaultOverlay.getContext('2d');badge.fillStyle='#102d42';badge.fillRect(0,0,360,220);badge.strokeStyle='#74f7d5';badge.lineWidth=9;badge.strokeRect(6,6,348,208);badge.fillStyle='#74f7d5';badge.font='bold 38px sans-serif';badge.textAlign='center';badge.fillText('FEATURE LENS',180,103);badge.font='24px sans-serif';badge.fillText('TRACKED',180,153);
let overlayImage=defaultOverlay;
const active=()=>['camera','demo','image','file-video'].includes(mode);

function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function options() {
  return {
    algorithm: $('algorithm').value,
    maxPoints: Number($('maxPoints').value),
    quality: 0.15 * Math.pow(0.001 / 0.15, Number($('sensitivity').value) / 100),
    minDistance: Number($('minDistance').value),
  };
}
function updateButtons() {
  $('start').disabled = $('emptyStart').disabled = mode === 'opening';
  $('stop').disabled = mode === 'idle';
  $('saveImage').disabled = $('savePoints').disabled = !frame;
  $('liveDot').classList.toggle('active',active());
  $('resetTracking').disabled = !['trails','flow','object'].includes(technique) || !active();
  $('selectRegion').disabled = !frame || !active() || frame.generation!==generation;
  $('selectRegion').textContent=selecting?'選択をキャンセル':'範囲を選択';
  $('objectControls').hidden=technique!=='object';
  $('videoControls').hidden=mode!=='file-video';
  $('inputResolution').disabled=['image','file-video'].includes(mode);
  $('quickStart').disabled=$('start').disabled;
  $('quickStop').disabled=$('stop').disabled;
  $('quickSelect').disabled=$('selectRegion').disabled;
  $('quickSelect').hidden=technique!=='object';
  $('quickSelect').textContent=$('selectRegion').textContent;
  $('selectionHelp').hidden=!selecting;
  // Selection and pause transitions must update button availability immediately,
  // independently of the less frequent progress-slider refresh.
  updateVideoControls();
}
function stop(silent = false) {
  generation++;
  selecting=false;drag=null;selection=null;seedNext=false;resumeAfterSeed=false;
  preview.classList.remove('selecting');
  cancelAnimationFrame(animation);
  closeFilePicker(false);
  if(videoCallback!==null)frameMedia?.cancelVideoFrameCallback?.(videoCallback);
  videoCallback=null;frameMedia=null;pacer.reset();lastVideoUI=0;lastMetrics=0;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; video.pause(); video.srcObject = null;
  localInput?.dispose();localInput=null;lastMediaTime=-1;lastTick=0;dirty=true;
  mode = 'idle'; pending = null; fps = 0; resultTimes = [];
  $('fps').textContent = '—';
  $('sourceLabel').textContent = frame ? '停止中 / 最後のフレーム' : '入力待機中';
  updateButtons();
  if (!silent) status('停止しました。カメラは解放されています。');
}
function ensureWorker() {
  if (worker) return;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (!pending || data.id !== pending.id) return;
    const job = pending; pending = null;
    if (job.generation !== generation || job.epoch !== epoch || selecting) return;
    if (data.error) { stop(true); status(`特徴点の処理に失敗しました: ${data.error}`, true); return; }
    const now = performance.now();
    resultTimes.push(now);while(resultTimes.length>2 && resultTimes[0]<now-1500)resultTimes.shift();
    fps=resultTimes.length>=4?1000*(resultTimes.length-1)/(now-resultTimes[0]):0;
    const firstFrame=!frame||frame.generation!==job.generation;
    frame = { ...job, points: data.points, tracks: data.tracks, motion: data.motion, density: data.density, object:data.object, duration: data.duration };
    preview.dataset.source=job.source;preview.dataset.technique=job.technique;
    preview.dataset.inputName=job.inputName||'';
    preview.dataset.trackCount=data.tracks.length;preview.dataset.detectedCount=data.points.length;
    commitFrame();
    // Render every completed frame, but avoid rebuilding the control panel 60
    // times per second. Metrics are sampled from all results, not just UI ticks.
    if(firstFrame||job.seed||mode==='image'||(mode==='file-video'&&localInput?.element.paused)||now-lastMetrics>=150){
    lastMetrics=now;
    $('pointCount').textContent = data.points.length;
    $('fps').textContent = mode==='image'||(mode==='file-video'&&localInput?.element.paused)?'—':fps ? fps.toFixed(1) : '—';
    $('latency').textContent = data.duration.toFixed(1);
    $('resolution').textContent = `${job.originalWidth} × ${job.originalHeight}`;
    $('analysisResolution').textContent = `${job.width} × ${job.height}`;
    $('qualityNotice').textContent = job.width < Number($('processingWidth').value) ? '入力解像度が上限です（拡大なし）' : '入力以上には拡大せず解析しています';
    if(job.originalWidth!==job.sourceWidth||job.originalHeight!==job.sourceHeight)$('qualityNotice').textContent=`表示・保存は ${job.sourceWidth} × ${job.sourceHeight} に縮小（iPhone / iPad）`;
    $('demoStats').textContent = demoStats(frame);
    }
    $('objectStatus').textContent=data.object?.status==='tracking'?`${data.object.method==='appearance'?'画像照合で再捕捉':'追跡中'}：対応${data.object.inliers}点・補充${data.object.replenished||0}点。`:data.object?.reason||'「範囲を選択」で物体を囲んでください。';
    preview.dataset.objectStatus=data.object?.status||'unselected';
    $('emptyState').hidden = true; $('frameTag').hidden = false;
    $('frameTag').textContent = job.options.algorithm === 'harris' ? 'HARRIS' : 'SHI–TOMASI';
    if(firstFrame||job.seed)updateButtons();
    if(job.seed&&resumeAfterSeed){resumeAfterSeed=false;if(mode==='file-video')localInput.element.play().catch(()=>status('再生ボタンを押して動画を再開してください。'));}
  };
  worker.onerror = event => {
    event.preventDefault(); worker.terminate(); worker = null;
    stop(true); status('検出処理を開始できませんでした。ページを再読み込みしてください。', true);
  };
}
function drawPreview() {
  if (!frame) return;
  if (preview.width !== frame.sourceWidth || preview.height !== frame.sourceHeight) {
    preview.width = frame.sourceWidth; preview.height = frame.sourceHeight;
  }
  $('stage').classList.toggle('portrait',frame.sourceHeight>frame.sourceWidth);
  ctx.save();
  ctx.clearRect(0, 0, preview.width, preview.height);
  if ($('mirror').checked) { ctx.translate(preview.width, 0); ctx.scale(-1, 1); }
  // The captured frame and its points are rendered together, without overlay lag.
  ctx.drawImage(frameCanvas, 0, 0);
  renderOverlay(ctx,frame,$('showPoints').checked);
  drawObject();
  if(drag){ctx.strokeStyle='#fff0a4';ctx.lineWidth=Math.max(2,preview.width/500);ctx.setLineDash([8,5]);ctx.strokeRect(drag.start.x*preview.width,drag.start.y*preview.height,(drag.end.x-drag.start.x)*preview.width,(drag.end.y-drag.start.y)*preview.height);}
  ctx.restore();
}
// Keep the completed frame separate from the next in-flight capture.
let frameCanvas = document.createElement('canvas');
function drawDemo(time) {
  drawDemoScene(captureCtx,capture.width,capture.height,time,$('demoScene').value);
}
function tick(now) {
  if (!active()) return;
  animation = requestAnimationFrame(tick);
  const elapsed=lastTick?Math.min(100,now-lastTick):0;lastTick=now;
  if(!selecting&&mode==='demo')demoTime+=elapsed;
  if(now-lastVideoUI>=100){lastVideoUI=now;updateVideoControls();}
  if (pending || selecting || filePickerOpen || document.hidden) return;
  if (mode === 'camera' && video.readyState < 2) return;
  const media=localInput?.element;
  if(mode==='file-video'&&(media.readyState<2||media.seeking))return;
  if(!seedNext&&!dirty&&(mode==='image'||(mode==='file-video'&&!frameMedia?.requestVideoFrameCallback&&media.currentTime===lastMediaTime)))return;
  if(!seedNext&&!dirty&&frameMedia?.requestVideoFrameCallback&&sourceFrame===lastSourceFrame)return;
  if(!pacer.ready(now,Number($('targetFps').value)))return;
  const originalWidth = seedNext?frame.originalWidth:mode === 'camera' ? video.videoWidth : mode==='image'?media.naturalWidth:mode==='file-video'?media.videoWidth:Number($('inputResolution').value);
  const originalHeight = seedNext?frame.originalHeight:mode === 'camera' ? video.videoHeight : mode==='image'?media.naturalHeight:mode==='file-video'?media.videoHeight:Math.round(originalWidth*9/16);
  if (!originalWidth || !originalHeight) return;
  const {width:sourceWidth,height:sourceHeight}=previewSize(originalWidth,originalHeight);
  // Rotating an iPhone can change the camera dimensions without restarting it.
  if(frame?.generation===generation&&(frame.sourceWidth!==sourceWidth||frame.sourceHeight!==sourceHeight)){selection=null;epoch++;}
  try {
  if (capture.width !== sourceWidth || capture.height !== sourceHeight) { capture.width=sourceWidth; capture.height=sourceHeight; }
  captureCtx.clearRect(0,0,sourceWidth,sourceHeight);
  if(seedNext)captureCtx.drawImage(frameCanvas,0,0);
  else if (mode === 'camera') captureCtx.drawImage(video,0,0,sourceWidth,sourceHeight);
  else if(localInput)captureCtx.drawImage(media,0,0,sourceWidth,sourceHeight);
  else drawDemo(demoTime);
  // Bound both axes for tall files, preserving aspect ratio without upscaling.
  const ratio=Math.min(1,Number($('processingWidth').value)/sourceWidth,1920/sourceHeight);
  const width=Math.round(sourceWidth*ratio),height=Math.round(sourceHeight*ratio);
  if(width<9||height<9){stop(true);status('画像が小さすぎます。縦横9px以上の画像を選んでください。',true);return;}
  if (analysis.width !== width || analysis.height !== height) { analysis.width=width; analysis.height=height; }
  analysisCtx.clearRect(0,0,width,height);
  analysisCtx.drawImage(capture,0,0,width,height);
  const pixels = analysisCtx.getImageData(0,0,width,height);
  const timestamp=mode==='file-video'?media.currentTime*1000:mode==='demo'?demoTime:mode==='image'?0:now;
  pending = { id: ++sequence, generation, epoch, technique, timestamp, mediaTime:mode==='file-video'?media.currentTime:null, seed:seedNext,selection, width, height, sourceWidth, sourceHeight, originalWidth, originalHeight, options: options(), source: mode, inputName:localInput?.name||null, capturedAt: new Date().toISOString() };
  seedNext=false;dirty=false;if(mode==='file-video')lastMediaTime=media.currentTime;
  lastSourceFrame=sourceFrame;
  // Only this capture can be in flight; preserve it until the worker finishes.
  worker.postMessage({ ...pending, buffer: pixels.data.buffer }, [pixels.data.buffer]);
  }catch{stop(true);status('映像を解析できませんでした。別の画像・動画、または小さい解析サイズでお試しください。',true);}
}
// Publish the submitted image with its own detection result.
function commitFrame() {
  // Swap buffers instead of copying a full-resolution capture for every result.
  [frameCanvas,capture]=[capture,frameCanvas];
  captureCtx=capture.getContext('2d');
  drawPreview();
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const selected = stream?.getVideoTracks()[0]?.getSettings().deviceId || $('camera').value;
    $('camera').replaceChildren(new Option('既定のカメラ',''));
    devices.forEach((device,i) => $('camera').add(new Option(device.label || `カメラ ${i+1}`,device.deviceId)));
    if ([...$('camera').options].some(option => option.value === selected)) $('camera').value=selected;
  } catch { /* Camera access remains available even when enumeration is blocked. */ }
}
async function startCamera() {
  const deviceId = $('camera').value;
  stop(true);
  if (!navigator.mediaDevices?.getUserMedia) { status(window.isSecureContext?'このブラウザーではカメラを利用できません。iPhoneはSafariで開いてください。':'カメラにはHTTPS接続が必要です。PCで start-iphone.bat を起動し、接続案内に従ってSafariで開いてください。',true); return; }
  mode='opening'; const token=generation; updateButtons(); status('カメラの許可を待っています…');
  try {
    const requestedWidth=Number($('inputResolution').value);
    const acquired = await navigator.mediaDevices.getUserMedia(cameraConstraints(deviceId,$('facingMode').value,requestedWidth,Number($('targetFps').value)));
    if (token !== generation) { acquired.getTracks().forEach(track=>track.stop()); return; }
    stream=acquired;video.srcObject=stream;await video.play();
    if (token !== generation) return;
    ensureWorker();mode='camera';watchFrames(video);
    const track=stream.getVideoTracks()[0];
    const facing=track.getSettings().facingMode||$('facingMode').value;
    if(facing)$('mirror').checked=facing==='user';
    track.addEventListener('mute',()=>{if(token===generation)status('カメラが一時停止しています。戻らない場合は「カメラ開始」を押してください。');});
    track.addEventListener('unmute',()=>{if(token===generation){resetAnalysis();status('カメラ映像を再開しました。');}});
    track.addEventListener('ended',()=>{if(token===generation){stop(true);status('カメラとの接続が切れました。接続を確認して再度開始してください。',true);}});
    $('sourceLabel').textContent=track.label || 'ウェブカメラ';
    status('カメラ映像から特徴点を検出しています。設定はリアルタイムで反映されます。');
    updateButtons();refreshDevices();animation=requestAnimationFrame(tick);
  } catch(error) {
    if(token!==generation)return;
    stop(true);
    const messages={NotAllowedError:'カメラの使用が許可されていません。Safariなどのブラウザーのサイト設定でカメラを許可し、端末のカメラ権限も確認して再度開始してください。',NotFoundError:'カメラが見つかりません。接続を確認するか、デモ映像をお試しください。',NotReadableError:'カメラを開けません。他のカメラアプリを終了して再度お試しください。',OverconstrainedError:'選択したカメラを利用できません。「既定のカメラ」を選んで再度お試しください。',SecurityError:'カメラへのアクセスが制限されています。ブラウザーの設定をご確認ください。'};
    status(messages[error.name] || `カメラを開始できませんでした (${error.name || 'エラー'})。`,true);
  }
}
function startDemo() {
  stop(true);ensureWorker();mode='demo';$('sourceLabel').textContent='デモ / 動く図形';
  status('デモ映像を解析しています。カメラは使用していません。');updateButtons();animation=requestAnimationFrame(tick);
}
function resetAnalysis() {if(selecting)cancelSelection();epoch++;resultTimes=[];dirty=true;selection=null;seedNext=false;preview.dataset.objectStatus='unselected';if(frame){frame.object=null;drawPreview();}}
function setTechnique(value) {
  technique=value;resetAnalysis();
  cancelSelection();
  for(const button of document.querySelectorAll('[data-technique]'))button.setAttribute('aria-pressed',String(button.dataset.technique===value));
  $('techTitle').textContent=techniques[value].title;$('techDescription').textContent=techniques[value].description;
  if(mode==='demo'||mode==='idle')$('demoScene').value=techniques[value].scene;
  if(mode==='idle')startDemo();
  updateButtons();
}
function drawObject() {
  const object=frame.object;
  if(frame.technique!=='object'||!['tracking','coasting'].includes(object?.status))return;
  const sx=frame.sourceWidth/frame.width,sy=frame.sourceHeight/frame.height,m=object.transform,r=object.roi;
  ctx.save();ctx.scale(sx,sy);ctx.translate(0.5,0.5);ctx.transform(m.a,m.b,-m.b,m.a,m.tx,m.ty);
  const imageWidth=overlayImage.naturalWidth||overlayImage.width,imageHeight=overlayImage.naturalHeight||overlayImage.height;
  let w=r.width,h=r.height;
  if($('overlayFit').value==='contain'){const scale=Math.min(w/imageWidth,h/imageHeight);w=imageWidth*scale;h=imageHeight*scale;}
  const scale=Number($('overlayScale').value)/100;w*=scale;h*=scale;
  ctx.globalAlpha=Number($('overlayOpacity').value)/100;
  ctx.drawImage(overlayImage,r.x+(r.width-w)/2,r.y+(r.height-h)/2,w,h);ctx.globalAlpha=1;
  if($('showTargetBox').checked||object.status==='coasting'){ctx.strokeStyle=object.status==='coasting'?'#ffd68b':'#8ef9d4';ctx.lineWidth=1.5/m.scale;if(object.status==='coasting')ctx.setLineDash([5,4]);ctx.strokeRect(r.x,r.y,r.width,r.height);}
  ctx.restore();
  if($('showPoints').checked){ctx.fillStyle='#ffdb8c';for(const p of object.tracks){ctx.beginPath();ctx.arc((p.x+0.5)*sx,(p.y+0.5)*sy,Math.max(2,frame.sourceWidth/500),0,Math.PI*2);ctx.fill();}}
}
async function loadSourceFile(file) {
  if(!file)return;
  stop(true);const token=generation;mode='loading-file';updateButtons();status(`読み込み中: ${file.name}`);
  try {
    const input=openLocalMedia(file,$('mediaHost'));localInput=input;await input.ready;
    if(token!==generation)return;
    if(input.type==='file-video')await resolveDuration(input.element);
    if(token!==generation)return;
    mode=input.type;$('mirror').checked=false;dirty=true;ensureWorker();
    if(mode==='file-video')watchFrames(input.element);
    $('sourceLabel').textContent=file.name;
    if(mode==='file-video'){
      const media=input.element;media.loop=$('videoLoop').checked;
      media.addEventListener('seeking',()=>{if(token===generation){resetAnalysis();lastMediaTime=-1;}});
      media.addEventListener('seeked',()=>{if(token===generation)dirty=true;});
      media.addEventListener('ended',()=>{if(token===generation){dirty=true;updateVideoControls();}});
      media.addEventListener('error',()=>{if(token===generation){stop(true);status('動画の再生中にエラーが発生しました。別の形式でお試しください。',true);}});
    }
    status(mode==='image'?'画像を解析しています。設定変更や範囲の選択ができます。':'動画を読み込みました。再生ボタンで解析を開始できます（音声は再生しません）。');
    updateButtons();animation=requestAnimationFrame(tick);
  }catch(error){if(token!==generation)return;stop(true);status(error.message,true);}
}
function formatTime(seconds) {if(!Number.isFinite(seconds))return '—';return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;}
function updateVideoControls() {
  if(mode!=='file-video'||!localInput)return;
  const media=localInput.element,finite=Number.isFinite(media.duration)&&media.duration>0;
  $('playPause').textContent=media.paused?'再生':'一時停止';$('playPause').disabled=selecting;
  $('videoSeek').disabled=!finite||selecting;
  $('videoSeek').max=finite?media.duration:1;$('videoSeek').value=finite?media.currentTime:0;
  $('videoTime').textContent=`${formatTime(media.currentTime)} / ${formatTime(media.duration)}`;
  if(media.paused)$('fps').textContent='—';
}
function beginSelection() {
  if(selecting){cancelSelection();return;}
  if(!frame||!active()||frame.source!==mode||frame.generation!==generation)return;
  epoch++;selection=null;seedNext=false;selecting=true;drag=null;frame.object=null;
  preview.dataset.objectStatus='unselected';
  if(mode==='demo')demoTime=frame.timestamp;
  resumeAfterSeed=mode==='file-video'&&!localInput.element.paused;
  if(mode==='file-video')localInput.element.pause();
  preview.classList.add('selecting');drawPreview();updateButtons();
  if(matchMedia('(max-width: 760px)').matches)$('selectionHelp').scrollIntoView({block:'start'});
  status('映像を固定しました。指やマウスで物体を囲んでください。「キャンセル」で戻れます。');
}
function cancelSelection() {
  if(!selecting)return;
  selecting=false;drag=null;preview.classList.remove('selecting');dirty=true;
  if(resumeAfterSeed&&mode==='file-video')localInput.element.play().catch(()=>{});
  resumeAfterSeed=false;drawPreview();updateButtons();
}
function pointer(event,clamp=false) {return previewPoint(event.clientX,event.clientY,preview.getBoundingClientRect(),frame.sourceWidth,frame.sourceHeight,$('mirror').checked,clamp);}
preview.addEventListener('pointerdown',event=>{
  if(!selecting||event.button!==0||!event.isPrimary||drag)return;
  const p=pointer(event);if(!p)return;
  drag={start:p,end:p,pointerId:event.pointerId};preview.setPointerCapture(event.pointerId);event.preventDefault();drawPreview();
});
preview.addEventListener('pointermove',event=>{if(selecting&&drag?.pointerId===event.pointerId){drag.end=pointer(event,true);drawPreview();}});
preview.addEventListener('pointerup',event=>{
  if(!selecting||!drag||drag.pointerId!==event.pointerId)return;
  drag.end=pointer(event,true);const a=drag.start,b=drag.end;drag=null;
  if(preview.hasPointerCapture(event.pointerId))preview.releasePointerCapture(event.pointerId);
  const width=Math.abs(a.x-b.x),height=Math.abs(a.y-b.y);
  if(width*frame.width<12||height*frame.height<12){drawPreview();status('範囲が小さすぎます。模様を含む、もう少し大きな範囲を囲んでください。');return;}
  selection={id:++selectionId,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width,height};
  seedNext=true;dirty=true;selecting=false;preview.classList.remove('selecting');updateButtons();
  status('選択範囲の特徴点を使って画像を重ね合わせます。');
});
preview.addEventListener('pointercancel',cancelSelection);
window.addEventListener('keydown',event=>{if(event.key==='Escape')cancelSelection();});
async function loadOverlay(file) {
  if(!file)return;
  const id=++overlayLoadId,url=URL.createObjectURL(mediaBlob(file)),image=new Image();
  try {image.src=url;await image.decode();if(id!==overlayLoadId)return;
    const size=previewSize(image.naturalWidth,image.naturalHeight);
    if(size.width!==image.naturalWidth||size.height!==image.naturalHeight){
      const reduced=document.createElement('canvas');reduced.width=size.width;reduced.height=size.height;
      reduced.getContext('2d').drawImage(image,0,0,size.width,size.height);overlayImage=reduced;
    }else overlayImage=image;
    $('overlayName').textContent=file.name;drawPreview();}
  catch{if(id===overlayLoadId)status(mediaError(file),true);}
  finally{URL.revokeObjectURL(url);}
}
function download(blob,filename) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function saveFile(blob,filename) {
  const file=new File([blob],filename,{type:blob.type});
  if(!appleMobile||!navigator.canShare?.({files:[file]})){download(blob,filename);return;}
  // A second tap retains Safari's required user activation after PNG encoding.
  preparedFile=file;$('shareName').textContent=`保存の準備ができました。「共有して保存」から画像を保存、または「ファイルに保存」を選んでください。`;
  $('sharePanel').hidden=false;$('sharePanel').scrollIntoView({block:'nearest'});
}
const stamp = () => new Date().toISOString().replace(/[:.]/g,'-');
$('start').addEventListener('click',startCamera);$('emptyStart').addEventListener('click',startCamera);
$('demo').addEventListener('click',startDemo);$('emptyDemo').addEventListener('click',startDemo);
$('stop').addEventListener('click',()=>stop());
$('quickStart').addEventListener('click',startCamera);$('quickStop').addEventListener('click',()=>stop());
$('quickSelect').addEventListener('click',beginSelection);$('cancelSelection').addEventListener('click',cancelSelection);
$('facingMode').addEventListener('change',()=>{$('camera').value='';if(mode==='camera'||mode==='opening')startCamera();});
$('switchCamera').addEventListener('click',()=>{
  const current=stream?.getVideoTracks()[0]?.getSettings().facingMode||$('facingMode').value;
  $('facingMode').value=current==='user'?'environment':'user';$('camera').value='';startCamera();
});
$('sharePrepared').addEventListener('click',async()=>{
  if(!preparedFile)return;
  try{await navigator.share({files:[preparedFile]});$('sharePanel').hidden=true;preparedFile=null;}
  catch(error){if(error.name!=='AbortError')status('共有できませんでした。「ダウンロード」から保存してください。',true);}
});
$('downloadPrepared').addEventListener('click',()=>{if(preparedFile)download(preparedFile,preparedFile.name);});
$('closeShare').addEventListener('click',()=>{$('sharePanel').hidden=true;preparedFile=null;});
$('sourceFile').addEventListener('change',event=>{closeFilePicker(false);loadSourceFile(event.target.files[0]);event.target.value='';});
$('originalFile').addEventListener('change',event=>{closeFilePicker(false);loadSourceFile(event.target.files[0]);event.target.value='';});
$('overlayFile').addEventListener('change',event=>{closeFilePicker();loadOverlay(event.target.files[0]);event.target.value='';});
$('selectRegion').addEventListener('click',beginSelection);
$('clearRegion').addEventListener('click',()=>{resetAnalysis();$('objectStatus').textContent='選択を解除しました。';});
for(const id of ['overlayOpacity','overlayScale'])$(id).addEventListener('input',()=>{$(`${id}Value`).textContent=$(id).value+'%';drawPreview();});
for(const id of ['overlayFit','showTargetBox'])$(id).addEventListener('change',drawPreview);
$('playPause').addEventListener('click',()=>{
  if(mode!=='file-video'||selecting)return;
  const media=localInput.element;
  if(media.paused){if(media.ended)media.currentTime=0;media.play().catch(()=>status('この動画を再生できませんでした。',true));}
  else media.pause();resultTimes=[];updateVideoControls();
});
$('videoSeek').addEventListener('input',()=>{if(mode==='file-video'&&!selecting)localInput.element.currentTime=Number($('videoSeek').value);});
$('videoLoop').addEventListener('change',()=>{if(mode==='file-video')localInput.element.loop=$('videoLoop').checked;});
$('camera').addEventListener('change',()=>{$('facingMode').value='';if(mode==='camera'||mode==='opening')startCamera();});
for(const button of document.querySelectorAll('[data-technique]'))button.addEventListener('click',()=>setTechnique(button.dataset.technique));
$('resetTracking').addEventListener('click',resetAnalysis);
$('demoScene').addEventListener('change',resetAnalysis);
$('processingWidth').addEventListener('change',resetAnalysis);
$('inputResolution').addEventListener('change',()=>{resetAnalysis();if(mode==='camera'||mode==='opening')startCamera();});
$('targetFps').addEventListener('change',()=>{pacer.reset();if(mode==='camera'||mode==='opening')startCamera();});
$('highDetail').addEventListener('click',()=>{
  $('inputResolution').value='1920';$('processingWidth').value='1920';$('maxPoints').value='1500';$('maxPointsValue').textContent='1500';
  resetAnalysis();if(mode==='camera'||mode==='opening')startCamera();
  else if(mode==='idle')startDemo();
});
$('lightweight').addEventListener('click',()=>{
  $('inputResolution').value='1280';$('processingWidth').value='480';$('maxPoints').value='250';$('maxPointsValue').textContent='250';
  resetAnalysis();if(mode==='camera'||mode==='opening')startCamera();else if(mode==='idle')startDemo();
});
for (const id of ['maxPoints','sensitivity','minDistance']) $(id).addEventListener('input',()=>{$(`${id}Value`).textContent=$(id).value+(id==='minDistance'?' px':'');dirty=true;});
$('algorithm').addEventListener('change',resetAnalysis);
for(const id of ['showPoints','mirror'])$(id).addEventListener('change',drawPreview);
$('saveImage').addEventListener('click',()=>preview.toBlob(blob=>{if(blob)saveFile(blob,`feature-lens-${stamp()}.png`);else status('画像を保存できませんでした。軽量プリセットでお試しください。',true);},'image/png'));
$('savePoints').addEventListener('click',()=>{
  if(!frame)return;
  const sx=frame.sourceWidth/frame.width,sy=frame.sourceHeight/frame.height;
  const toSource=p=>({x:Number(((p.x+0.5)*sx).toFixed(3)),y:Number(((p.y+0.5)*sy).toFixed(3))});
  const output={version:2,capturedAt:frame.capturedAt,source:frame.source,technique:frame.technique,algorithm:frame.options.algorithm,image:{width:frame.sourceWidth,height:frame.sourceHeight},analysis:{width:frame.width,height:frame.height},coordinateSystem:'Original unmirrored image; top-left origin; x rightward, y downward; pixel centers',options:frame.options,points:frame.points.map(p=>({...toSource(p),score:p.score})),tracks:frame.tracks.map(t=>({...toSource(t),id:t.id,age:t.age,dx:t.dx*sx,dy:t.dy*sy,trail:t.trail.map(toSource)})),motion:{matched:frame.motion.matched,dx:frame.motion.dx*sx,dy:frame.motion.dy*sy,unit:'source pixels per analyzed frame'},density:frame.density};
  output.version=4;output.mediaTime=frame.mediaTime;output.object=frame.object?{status:frame.object.status,reason:frame.object.reason,method:frame.object.method,replenished:frame.object.replenished,inliers:frame.object.inliers,roi:frame.object.roi,transform:frame.object.transform,coordinateSystem:'Analysis pixel indices; use (x + 0.5) * image.width / analysis.width for source x, likewise y'}:null;
  output.version=5;output.input={width:frame.originalWidth,height:frame.originalHeight};
  output.coordinateSystem='Unmirrored preview/export image; top-left origin; x rightward, y downward; pixel centers. Scale x by input.width/image.width and y by input.height/image.height for original input coordinates.';
  saveFile(new Blob([JSON.stringify(output,null,2)],{type:'application/json'}),`feature-points-${stamp()}.json`);
});
navigator.mediaDevices?.addEventListener('devicechange',refreshDevices);
window.addEventListener('pagehide',()=>stop(true));
window.addEventListener('pageshow',event=>{if(event.persisted)status('カメラを再開するには「カメラ開始」を押してください。');});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&mode==='camera'){resetAnalysis();video.play().catch(()=>status('カメラを再開するには「カメラ開始」を押してください。'));}
});
if(appleMobile){$('facingMode').value='environment';$('mirror').checked=false;}
$('connectionNotice').hidden=window.isSecureContext;
refreshDevices();updateButtons();
startOfflineSupport();
