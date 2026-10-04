import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const contentType={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
export async function runPwaSmoke({send,evaluate,click,waitFor,artifacts}) {
  const dist=join(root,'dist');
  let swOverride=null;
  const server=createServer(async(req,res)=>{
    const route=new URL(req.url,'http://localhost').pathname;
    const prefix='/webcam-feature-viewer/';
    if(!route.startsWith(prefix)){res.writeHead(404).end();return;}
    const name=route.slice(prefix.length)||'index.html';
    if(!/^[\w./-]+$/.test(name)||name.split('/').includes('..')){res.writeHead(404).end();return;}
    try{
      const body=name==='sw.js'&&swOverride?swOverride:await readFile(join(dist,name));
      const extension=name.slice(name.lastIndexOf('.'));
      res.writeHead(200,{'Content-Type':contentType[extension]||'application/octet-stream','Cache-Control':'no-store'}).end(body);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/webcam-feature-viewer/`;
  try {
    await send('Page.navigate',{url:url+'?pwa-test=1'});
    await waitFor("document.getElementById('offlinePanel')?.dataset.ready==='true'",'PWA shell cached');
    const manifest=await evaluate("(async()=>{const r=await fetch('./manifest.webmanifest');return r.json()})()");
    assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
    assert.equal(await evaluate("navigator.serviceWorker.controller.scriptURL.includes('/webcam-feature-viewer/sw.js')"),true);
    console.log('PASS: project-subpath installation caches all static assets');
    await send('Network.enable');
    await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await send('Page.reload');
    await waitFor("document.getElementById('offlinePanel')?.dataset.ready==='true'",'offline reload');
    await click('quickStart');
    await waitFor("document.getElementById('preview').dataset.source==='camera' && Number(document.getElementById('pointCount').textContent)>0",'offline camera');
    await click('quickStop');
    const {root:dom}=await send('DOM.getDocument');
    const input=(await send('DOM.querySelector',{nodeId:dom.nodeId,selector:'#sourceFile'})).nodeId;
    await click('tech-object');
    await send('DOM.setFileInputFiles',{nodeId:input,files:[join(artifacts,'portrait-input.png')]});
    await waitFor("document.getElementById('preview').dataset.source==='image'",'offline photo');
    await click('quickSelect');
    const box=await evaluate("(()=>{const c=document.getElementById('preview'),r=c.getBoundingClientRect(),s=Math.min(r.width/c.width,r.height/c.height);return {x:r.left+(r.width-c.width*s)/2,y:r.top+(r.height-c.height*s)/2,w:c.width*s,h:c.height*s};})()");
    const p=(x,y)=>({x:box.x+box.w*x,y:box.y+box.h*y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...p(.15,.2),button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p(.8,.8),button:'left',buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p(.8,.8),button:'left',clickCount:1});
    await waitFor("document.getElementById('preview').dataset.objectStatus==='tracking'",'offline image overlay');
    await click('saveImage');await click('savePoints');
    await send('DOM.setFileInputFiles',{nodeId:input,files:[join(artifacts,'moving-input.webm')]});
    await waitFor("document.getElementById('preview').dataset.source==='file-video' && document.getElementById('fileVideo').paused",'offline video');
    await click('playPause');
    await waitFor("document.getElementById('fileVideo').currentTime>0.4 && Number(document.getElementById('pointCount').textContent)>0",'offline video analysis');
    await click('playPause');
    console.log('PASS: offline reload, camera, photo tracking, video analysis and exports');
    await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:0,uploadThroughput:0});
    const original=await readFile(join(dist,'sw.js'),'utf8');
    swOverride=original.replace(/const VERSION = '[^']+';/,"const VERSION = 'pwa-smoke-new-version';");
    await evaluate("(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()})()");
    await waitFor("!document.getElementById('applyUpdate').hidden",'update ready without reload');
    await click('quickStart');
    await waitFor("document.getElementById('preview').dataset.source==='camera' && document.getElementById('video').srcObject?.active",'camera active before update');
    assert.equal(await evaluate("document.getElementById('applyUpdate').hidden"),false);
    assert.equal(await evaluate("document.getElementById('video').srcObject.active"),true);
    await click('applyUpdate');
    await waitFor("document.getElementById('offlinePanel')?.dataset.ready==='true' && document.getElementById('applyUpdate').hidden",'applied update');
    assert.equal(await evaluate("document.getElementById('video').srcObject"),null);
    console.log('PASS: complete update waits for a tap and does not interrupt the camera');
  } finally {
    await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:0,uploadThroughput:0}).catch(()=>{});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
}
