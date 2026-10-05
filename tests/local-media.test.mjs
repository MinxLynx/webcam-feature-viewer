import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaType,mediaBlob,mediaError,openLocalMedia} from '../public/local-media.js';

test('iPhone files are identified even with missing or generic MIME metadata',()=>{
  for(const [name,mime,type] of [
    ['IMG_001.HEIC','image/heic','image'],['IMG_002.heif','image/heif','image'],
    ['IMG_003.JPG','image/jpeg','image'],['IMG_004.PNG','image/png','image'],
    ['IMG_005.MOV','video/quicktime','file-video'],['IMG_006.mp4','video/mp4','file-video'],
    ['export.m4v','video/mp4','file-video'],
  ])for(const supplied of ['', 'application/octet-stream']){
    const file=new File(['local bytes'],name,{type:supplied});
    assert.deepEqual(mediaType(file),{mime,type});
    const blob=mediaBlob(file);assert.equal(blob.type,mime);assert.equal(blob.size,file.size);
  }
  assert.equal(mediaType({name:'unknown',type:'image/jpeg'}).type,'image');
  assert.equal(mediaType({name:'notes.txt',type:'text/plain'}).type,null);
});

test('iPhone MIME normalization preserves file contents',async()=>{
  const file=new File([new Uint8Array([0,1,255,4])],'IMG.MOV');
  assert.deepEqual(await mediaBlob(file).arrayBuffer(),await file.arrayBuffer());
  const jpeg=new File(['jpeg'],'photo.jpg',{type:'image/jpeg'});
  assert.equal(mediaBlob(jpeg),jpeg);
  assert.match(mediaError(new File([''],'photo.heic')),/iOS 17/);
  assert.match(mediaError(file),/H.264・HEVC/);
});

class Video extends EventTarget {
  constructor(){super();this.readyState=0;this.videoWidth=0;this.videoHeight=0;this.currentTime=0;this.paused=true;this.attrs=new Set();}
  setAttribute(name){this.attrs.add(name);}
  removeAttribute(name){this.attrs.delete(name);}
  load(){}
  remove(){this.removed=true;}
  pause(){this.paused=true;}
  play(){this.playCalls=(this.playCalls||0)+1;this.paused=false;return Promise.resolve();}
  metadata(){this.readyState=1;this.videoWidth=1920;this.videoHeight=1080;this.dispatchEvent(new Event('loadedmetadata'));}
}
function environment(t){
  const video=new Video();
  const old=globalThis.document;
  globalThis.document={createElement:()=>video};
  t.after(()=>{if(old===undefined)delete globalThis.document;else globalThis.document=old;});
  const host={replaceChildren:element=>assert.equal(element,video)};
  const input=openLocalMedia(new File(['movie'],'IMG.MOV'),host);
  // Attach rejection handling before firing errors or replacing an input.
  const ready=input.ready;
  t.after(()=>input.dispose());
  return {video,input,ready};
}

test('Safari video waits for a decoded frame even when loadeddata is omitted',async t=>{
  const {video,ready}=environment(t);
  let resolved=false;ready.then(()=>{resolved=true;});
  video.metadata();await Promise.resolve();
  assert.equal(resolved,false);assert.equal(video.playCalls,1);
  video.readyState=2; // Safari may supply the frame without a loadeddata event.
  await ready;assert.equal(video.paused,true);assert.equal(video.currentTime,0);
  assert.equal(video.muted,true);assert.equal(video.playsInline,true);
});

test('a video error is reported and replacement cancels a pending load',async t=>{
  const {video,input,ready}=environment(t);
  const rejected=assert.rejects(ready,/MOV \/ MP4/);
  video.dispatchEvent(new Event('error'));await rejected;
  input.dispose();assert(video.removed);
});

test('replacing a video during muted initialization releases playback and URL',async t=>{
  const {video,input,ready}=environment(t);
  const rejected=assert.rejects(ready,{name:'AbortError'});
  video.metadata();input.dispose();await rejected;
  assert.equal(video.paused,true);assert(video.removed);
});
