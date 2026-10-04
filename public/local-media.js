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
export function openLocalMedia(file,host) {
  const type=file.type.startsWith('image/')||/\.(png|jpe?g|webp|bmp|gif|avif|heic|heif)$/i.test(file.name)?'image':file.type.startsWith('video/')||/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)?'file-video':null;
  if(!type)throw new Error('画像または動画ファイルを選んでください。');
  const url=URL.createObjectURL(file),element=type==='image'?new Image():document.createElement('video');
  element.id=type==='image'?'inputImage':'fileVideo';
  if(type==='file-video'){element.muted=true;element.defaultMuted=true;element.playsInline=true;element.setAttribute('playsinline','');element.setAttribute('webkit-playsinline','');element.preload='auto';}
  host.replaceChildren(element);
  let cleanup=()=>{},rejectLoad,disposed=false;
  const ready=new Promise((resolve,reject)=>{
    rejectLoad=reject;
    const event=type==='image'?'load':'loadeddata';
    const done=()=>{cleanup();resolve();};
    const error=()=>{cleanup();reject(new Error('このファイルを読み込めません。JPEG / PNG画像、またはMP4（H.264）など、このブラウザーが再生できる形式でお試しください。'));};
    const timer=setTimeout(()=>{cleanup();reject(new Error('ファイルの読み込みに時間がかかっています。別のファイルでお試しください。'));},20000);
    cleanup=()=>{clearTimeout(timer);element.removeEventListener(event,done);element.removeEventListener('error',error);};
    element.addEventListener(event,done);element.addEventListener('error',error);element.src=url;
    if(type==='file-video')element.load();
  });
  return {type,element,url,name:file.name,ready,dispose(){
    if(disposed)return;disposed=true;cleanup();rejectLoad(new DOMException('Input replaced','AbortError'));
    if(type==='file-video')element.pause();element.removeAttribute('src');if(type==='file-video')element.load();element.remove();URL.revokeObjectURL(url);
  }};
}
