import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Chromium mobile emulation exercises touch and iOS branches, not Safari itself.
export async function runIPhoneSmoke({send,evaluate,click,waitFor,delay,artifacts}) {
  await send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',platform:'iPhone'});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.reload');
  await waitFor("document.readyState==='complete' && document.getElementById('facingMode')?.value==='environment'",'iPhone defaults');
  await evaluate("window.nativeCamera=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=c=>{window.cameraRequest=c;return window.nativeCamera(c)}");
  await click('quickStart');
  await waitFor("document.getElementById('preview').dataset.source==='camera' && document.getElementById('video').srcObject?.active",'mobile camera');
  assert.equal(await evaluate("window.cameraRequest.video.facingMode.ideal"),'environment');
  assert.equal(await evaluate("document.getElementById('mirror').checked"),false);
  await evaluate("window.backTrack=document.getElementById('video').srcObject.getVideoTracks()[0]");
  await click('switchCamera');
  await waitFor("window.cameraRequest.video.facingMode.ideal==='user' && document.getElementById('mirror').checked && document.getElementById('video').srcObject?.active",'front camera');
  assert.equal(await evaluate('window.backTrack.readyState'),'ended');
  await click('quickStop');
  console.log('PASS: iPhone rear default, front switch, mirroring and camera release');
  const large=await evaluate(`(()=>{const c=document.createElement('canvas');c.width=2400;c.height=3200;const x=c.getContext('2d');x.fillStyle='#182f39';x.fillRect(0,0,c.width,c.height);for(let y=200;y<3000;y+=120)for(let u=200;u<2200;u+=120){x.fillStyle=(Math.floor(u/120)+Math.floor(y/120))%2?'#dbe9c6':'#35778c';x.fillRect(u,y,120,120);}return c.toDataURL().split(',')[1];})()`);
  const file=join(artifacts,'iphone-large-photo.png');await writeFile(file,Buffer.from(large,'base64'));
  await click('tech-object');
  const {root}=await send('DOM.getDocument'),{nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'#sourceFile'});
  await send('DOM.setFileInputFiles',{nodeId,files:[file]});
  await waitFor("document.getElementById('resolution').textContent==='2400 × 3200' && document.getElementById('preview').width===1536 && document.getElementById('preview').height===2048",'large iPhone photo');
  await click('quickSelect');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('preview')).touchAction"),'none');
  const box=await evaluate("(()=>{const c=document.getElementById('preview'),r=c.getBoundingClientRect(),s=Math.min(r.width/c.width,r.height/c.height);return {x:r.left+(r.width-c.width*s)/2,y:r.top+(r.height-c.height*s)/2,w:c.width*s,h:c.height*s};})()");
  const point=(x,y)=>({x:box.x+box.w*x,y:box.y+box.h*y,id:1,radiusX:4,radiusY:4,force:1});
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(.15,.15)]});
  await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(.8,.8)]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await waitFor("document.getElementById('preview').dataset.objectStatus==='tracking'",'touch region overlay');
  assert.equal(await evaluate("document.getElementById('selectionHelp').hidden"),true);
  await evaluate("document.querySelector('.viewer-panel').scrollIntoView()");
  await writeFile(join(artifacts,'iphone-touch-overlay.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('quickSelect');await click('cancelSelection');
  assert.equal(await evaluate("document.getElementById('preview').classList.contains('selecting')"),false);
  console.log('PASS: large photo cap, portrait display, real touch drag and cancel button');
  await evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedFile=data.files[0]}})");
  await click('saveImage');await waitFor("!document.getElementById('sharePanel').hidden",'PNG ready for share');
  await click('sharePrepared');
  assert.equal(await evaluate('window.sharedFile.type'),'image/png');
  assert.deepEqual(await evaluate('(async()=>{const b=new DataView(await window.sharedFile.arrayBuffer());return [b.getUint32(16),b.getUint32(20)]})()'),[1536,2048]);
  await click('savePoints');await click('sharePrepared');
  const data=await evaluate('(async()=>JSON.parse(await window.sharedFile.text()))()');
  assert.deepEqual(data.input,{width:2400,height:3200});assert.deepEqual(data.image,{width:1536,height:2048});assert.equal(data.version,5);
  console.log('PASS: prepared PNG/JSON sharing and original input coordinate scaling');
  for(const [width,height] of [[320,740],[390,844],[844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await delay(100);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true,`${width}px layout overflows`);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await click('lightweight');assert.equal(await evaluate("document.getElementById('processingWidth').value"),'480');
  await evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
  assert.equal(await evaluate("document.getElementById('status').textContent.includes('再開')"),true);
  console.log('PASS: small/portrait/landscape layout, lightweight preset and return guidance');
}
