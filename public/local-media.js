export async function resolveDuration(media) {
  if(Number.isFinite(media.duration))return;
  const seek=time=>new Promise(resolve=>{
    let timer;
    const done=()=>{clearTimeout(timer);media.removeEventListener('seeked',done);media.removeEventListener('emptied',done);resolve();};
    media.addEventListener('seeked',done);media.addEventListener('emptied',done);timer=setTimeout(done,1500);
    try{media.currentTime=time;}catch{done();}
  });
  // Some locally recorded WebM files omit duration metadata. Let the browser
  // discover the last timestamp, then return to the first frame before display.
  await seek(1e9);if(media.hasAttribute('src'))await seek(0);
}
const formats = {
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp',
  gif:'image/gif', bmp:'image/bmp', avif:'image/avif', heic:'image/heic', heif:'image/heif',
  mp4:'video/mp4', m4v:'video/mp4', mov:'video/quicktime', webm:'video/webm', ogv:'video/ogg',
};
export function mediaType(file) {
  // Files selected from iCloud Drive can have an empty or generic MIME type.
  // Prefer the known extension, without converting or uploading the file.
  const mime=formats[file.name?.split('.').pop().toLowerCase()] || file.type || '';
  return {mime,type:mime.startsWith('image/')?'image':mime.startsWith('video/')?'file-video':null};
}
export function mediaBlob(file) {
  const {mime}=mediaType(file);
  return mime && mime!==file.type ? file.slice(0,file.size,mime) : file;
}
export function mediaError(file) {
  if(/\.(heic|heif)$/i.test(file.name)||/^image\/hei[cf]/i.test(file.type))return 'このHEIC / HEIF写真を読み込めませんでした。iOS 17以降のSafariで開くか、JPEG画像を選んでください。';
  if(mediaType(file).type==='file-video')return 'この動画を読み込めませんでした。iPhoneで撮影したMOV / MP4（H.264・HEVC）に対応していますが、編集アプリの特殊な形式は再生できない場合があります。別の動画か、H.264のMP4でお試しください。';
  return 'この画像を読み込めませんでした。HEIC / HEIF、JPEG、PNGなどの画像を選んでください。';
}
export function openLocalMedia(file,host) {
  const {type}=mediaType(file);
  if(!type)throw new Error('画像または動画ファイルを選んでください。');
  const url=URL.createObjectURL(mediaBlob(file)),element=type==='image'?new Image():document.createElement('video');
  element.id=type==='image'?'inputImage':'fileVideo';
  if(type==='file-video'){element.muted=true;element.defaultMuted=true;element.playsInline=true;element.setAttribute('playsinline','');element.setAttribute('webkit-playsinline','');element.preload='auto';}
  host.replaceChildren(element);
  let cleanup=()=>{},rejectLoad,disposed=false;
  const ready=new Promise((resolve,reject)=>{
    rejectLoad=reject;
    let primed=false,settled=false;
    const events=type==='image'?['load']:['loadedmetadata','loadeddata','canplay','seeked'];
    const done=()=>{
      if(settled)return;
      if(type==='file-video'){
        if(element.readyState<2 || !element.videoWidth || !element.videoHeight || element.seeking)return;
        element.pause();
        // Muted playback may be needed to decode a frame on iOS. Return to the
        // beginning before handing the paused video to the analysis loop.
        if(element.currentTime>0){element.currentTime=0;return;}
      }
      settled=true;cleanup();resolve();
    };
    const check=()=>{
      if(type==='file-video' && element.readyState>=1 && element.readyState<2 && !primed){
        primed=true;const playing=element.play();playing?.then(()=>{if(settled||disposed)element.pause();else done();}).catch(()=>{});
      }
      done();
    };
    const error=()=>{if(settled)return;settled=true;if(type==='file-video')element.pause();cleanup();reject(new Error(mediaError(file)));};
    const timer=setTimeout(()=>{if(settled)return;settled=true;if(type==='file-video')element.pause();cleanup();reject(new Error('ファイルの読み込みに時間がかかっています。iCloud上のファイルは端末にダウンロードしてから選び直してください。'));},30000);
    // Safari can update readyState without sending loadeddata (e.g. data saving).
    const poll=type==='file-video'?setInterval(check,100):null;
    cleanup=()=>{clearTimeout(timer);clearInterval(poll);for(const event of events)element.removeEventListener(event,check);element.removeEventListener('error',error);};
    for(const event of events)element.addEventListener(event,check);element.addEventListener('error',error);element.src=url;
    if(type==='file-video')element.load();
  });
  return {type,element,url,name:file.name,ready,dispose(){
    if(disposed)return;disposed=true;cleanup();rejectLoad(new DOMException('Input replaced','AbortError'));
    if(type==='file-video')element.pause();element.removeAttribute('src');if(type==='file-video')element.load();element.remove();URL.revokeObjectURL(url);
  }};
}
