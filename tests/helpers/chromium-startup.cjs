'use strict';
const fs=require('node:fs/promises'),path=require('node:path');

// Wait for the local debugging service, not a particular stderr chunk or a
// count of sleeps. The caller retains ownership of the browser process.
function waitForChromium({child,profileDir,timeoutMs=20000}) {
  return new Promise((resolve,reject)=>{
    const started=performance.now(),endpoints=new Set();
    let settled=false,tail='',partial='',pollTimer,deadlineTimer,activeRequest,lastIssue='No DevTools endpoint announced yet.';
    const loopback=url=>['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash;
    function endpointFrom(value) {
      try {
        const url=new URL(value),port=Number(url.port);
        if(url.protocol!=='ws:'||!loopback(url)||!Number.isInteger(port)||port<1||port>65535||!/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(url.pathname))return;
        endpoints.add('http://'+url.host+'/json/list');
      }catch{}
    }
    function onStderr(chunk) {
      const text=String(chunk);tail=(tail+text).slice(-4096);
      const lines=(partial+text).split(/\r?\n/);partial=lines.pop().slice(-4096);
      for(const line of lines){const match=line.trim().match(/^DevTools listening on (ws:\/\/\S+)$/);if(match)endpointFrom(match[1]);}
    }
    function finish(error,result) {
      if(settled)return;settled=true;
      clearTimeout(pollTimer);clearTimeout(deadlineTimer);activeRequest?.abort();
      child.stderr?.removeListener('data',onStderr);child.removeListener('error',onError);child.removeListener('exit',onExit);
      error?reject(new Error(error+'\n'+lastIssue+'\nChromium stderr (last 4096 chars):\n'+(tail||'(empty)'))):resolve(result);
    }
    const onError=error=>finish('Chromium spawn failed: '+error.message);
    const onExit=(code,signal)=>finish('Chromium exited before DevTools was ready (code '+code+', signal '+(signal||'none')+').');
    // stderr may already contain data if the child exited between spawn and
    // subscription. Drain it once before adding the live data listener.
    if(child.stderr?.read)for(let chunk=child.stderr.read();chunk!=null;chunk=child.stderr.read())onStderr(chunk);
    child.stderr?.on('data',onStderr);child.once('error',onError);child.once('exit',onExit);
    if(child.exitCode!=null||child.signalCode!=null){onExit(child.exitCode,child.signalCode);return;}
    deadlineTimer=setTimeout(()=>finish('Chromium DevTools readiness deadline exceeded ('+timeoutMs+' ms).'),timeoutMs);
    async function poll() {
      try {
        try {
          const file=await fs.readFile(path.join(profileDir,'DevToolsActivePort'),'utf8'),lines=file.trim().split(/\r?\n/);
          if(/^\d+$/.test(lines[0]||'')&&lines[1])endpointFrom('ws://127.0.0.1:'+lines[0]+lines[1]);
        }catch(error){if(error.code!=='ENOENT')lastIssue='DevToolsActivePort is not readable: '+(error.code||error.message);}
        if(settled)return;
        for(const endpoint of endpoints) {
          const remaining=timeoutMs-(performance.now()-started);if(remaining<=0)return;
          const controller=new AbortController();activeRequest=controller;
          const requestTimer=setTimeout(()=>controller.abort(),Math.min(1000,remaining));
          try {
            const response=await fetch(endpoint,{signal:controller.signal,redirect:'error'});
            if(!response.ok){lastIssue='DevTools endpoint returned HTTP '+response.status+'.';continue;}
            const targets=await response.json(),port=new URL(endpoint).port;
            const page=Array.isArray(targets)&&targets.find(target=>{
              if(target?.type!=='page'||typeof target.webSocketDebuggerUrl!=='string')return false;
              try {const url=new URL(target.webSocketDebuggerUrl);return url.protocol==='ws:'&&loopback(url)&&url.port===port&&/^\/devtools\/page\/[A-Za-z0-9-]+$/.test(url.pathname);}catch{return false;}
            });
            if(settled)return;
            if(page){finish(null,{endpoint,page});return;}
            lastIssue='DevTools endpoint has no usable page target yet.';
          }catch(error){if(!settled)lastIssue='DevTools endpoint is not ready: '+error.message;}
          finally {clearTimeout(requestTimer);if(activeRequest===controller)activeRequest=null;}
          if(settled)return;
        }
      }catch(error){if(!settled)lastIssue='DevTools readiness probe failed: '+error.message;}
      finally {if(!settled)pollTimer=setTimeout(poll,50);}
    }
    void poll();
  });
}
module.exports={waitForChromium};
