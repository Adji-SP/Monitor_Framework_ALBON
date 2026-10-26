// Isolated browser smoke test: mocked USB, synthetic video, no real ESP32 or screen capture.
// Run after npm run build. Requires Edge on Windows or BROWSER_PATH pointing to Chromium.
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict');
const http=require('node:http'), express=require('express'), {spawn}=require('node:child_process'), WS=require('ws');
process.chdir(path.resolve(__dirname,'..'));
const APIServer=require('../modules/api/apiServer'), controller=require('../App/Http/Controllers/recordsController');
const root=path.resolve('build'), output=fs.mkdtempSync(path.join(root,'recording-smoke-'));
controller.recordingStore.directory=output;
let browser, socket, server;
const deadline=setTimeout(()=>{console.error('Browser recording test timeout');socket?.terminate();browser?.kill();server?.close();process.exit(1);},45000);
(async()=>{
  const app=express();
  app.use('/records',express.static(output));
  app.use(new APIServer(null).getApp());
  app.use(express.static(root));
  server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;process.env.RECORDING_ORIGINS=origin;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fermentor-recording-browser-'));
  browser=spawn(process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new','--disable-gpu','--window-size=1600,1200','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],
    {windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{browser.on('error',reject);browser.stderr.on('data',c=>{const m=String(c).match(/DevTools listening on (ws:\/\/\S+)/);if(m)resolve(m[1]);});});
  const targets=await(await fetch(endpoint.replace('ws:','http:').replace(/\/devtools\/browser\/.*/,'/json/list'))).json();
  socket=new WS(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j);});
  let id=0;const pending=new Map();socket.on('message',data=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async(expression,awaitPromise=false)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const browserErrors=[];
  socket.on('message',data=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')browserErrors.push(m.params.exceptionDetails);});
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*']});
  const inject=`
    const originalFetch=window.fetch.bind(window);
    window.__apiOffline=true;
    window.fetch=(url,options)=>window.__apiOffline && String(url).includes('/api/health') ? Promise.reject(new Error('Test storage API unavailable')) : originalFetch(String(url).replace('http://localhost:3001',location.origin),options);
    // Synthetic test video only; actual native MediaRecorder and upload path.
    navigator.mediaDevices.getDisplayMedia=async options=>{
      window.__captureOptions=options;const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const context=canvas.getContext('2d');let n=0;
      setInterval(()=>{context.fillStyle='#122b3a';context.fillRect(0,0,640,360);context.fillStyle='white';context.font='28px sans-serif';context.fillText('Fermentor recording test '+n++,30,70);},100);
      window.__stream=canvas.captureStream(10);return window.__stream;
    };

    window.__wsCount=0;window.WebSocket=class {constructor(){window.__wsCount++;throw new Error('WebSocket must not be used for direct USB');}};
    window.__usbRequests=0;window.__usbWrites=[];window.__usbStreaming=false;window.__usbOpens=[];
    const mixer={version:1,driver:'BTS7960',boot_id:42,revision:2,uptime_ms:10000,state:'AUTO PAUSED',armed:false,output_pwm:0,configured_pwm:64,target_rpm:3,measured_rpm:null,hmi_connected:true,next_start_in_ms:0,run_remaining_ms:0,start_delay_ms:30000,run_duration_ms:120000,interval_ms:21600000};
    Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async(options)=>{
      window.__usbChooserOptions=options || null;
      window.__usbRequests++;
      let controller,timer;
      const encoder=new TextEncoder();
      const emit=line=>controller.enqueue(encoder.encode(line+'\\n'));
      window.__usbEmit=emit;
      const port={
        async open(options){
          window.__usbOpens.push(options.baudRate);
          if(window.__failNextOpen){window.__failNextOpen=false;throw new Error('Simulated driver rejected baud rate');}
          this.readable=new ReadableStream({start(c){controller=c;},cancel(){clearInterval(timer);}});
          this.writable=new WritableStream({write(bytes){
            const line=new TextDecoder().decode(bytes);window.__usbWrites.push(line);
            const words=line.trim().split(' ');const action=words[2];
            mixer.revision++;mixer.armed=action==='RESUME';mixer.state=mixer.armed?'AUTO WAIT':'AUTO PAUSED';mixer.next_start_in_ms=mixer.armed?30000:0;
            emit('[MIXER_ACK] '+JSON.stringify({id:Number(words[1]),ok:true,reason:'APPLIED'}));
            emit('[MIXER_STATUS] '+JSON.stringify(mixer));
          }});
          window.__openOptions=options;
          timer=setInterval(()=>{
            if(!window.__usbStreaming)return;
            mixer.uptime_ms+=500;
            emit('[MIXER_STATUS] '+JSON.stringify(mixer));
            const raw='================ SENSOR READINGS ================\\nDS18B20   : 28.62 C\\npH input  : 1448.8 mV\\npH/ADS    : 7.29 pH\\nPressure in: 0.508 V\\nPressure  : 0.03 bar\\n[O2] Bus(NoAcknowledge(Data))\\nO2        : OFFLINE\\nCO2       : OFFLINE\\nSCD41 T   : OFFLINE\\nSCD41 RH  : OFFLINE\\nSHT30 T   : 28.55 C\\nSHT30 RH  : 92.60 %RH\\n';
            const bytes=encoder.encode(raw);
            controller.enqueue(bytes.slice(0,71));controller.enqueue(bytes.slice(71));
          },500);
        },
        async close(){clearInterval(timer);window.__usbClosed=true;if(this.readable.locked||this.writable.locked)throw new Error('Streams still locked');}
      };
      return port;
    }}});

  `;
  await call('Page.addScriptToEvaluateOnNewDocument',{source:inject});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:origin+'/#dashboard'});await new Promise(r=>setTimeout(r,1000));

  assert.deepEqual(browserErrors,[], 'Application must render without browser runtime errors');
  assert.equal(await evaluate('window.__usbRequests'),0);
  assert.equal(await evaluate('window.__wsCount'),0);
  assert.equal(await evaluate("document.querySelector('h1').textContent"),'Live Dashboard');
  assert.equal(await evaluate("document.querySelector('.dashboard-hero')"),null);
  assert.equal(await evaluate("document.querySelectorAll('.dashboard-gauges .gauge-card').length"),9);
  assert.equal(await evaluate("Boolean(document.querySelector('.dashboard-rail > .serial-monitor:first-child'))"),true);
  assert.equal(await evaluate("document.querySelector('.serial-monitor').getBoundingClientRect().left > document.querySelector('.dashboard-trends').getBoundingClientRect().right"),true,'Serial monitor belongs to the right of the plots');
  const expandedLeft=await evaluate("document.querySelector('.layout').getBoundingClientRect().left");
  const waitingShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(root,'dashboard-monitor-waiting.png'),Buffer.from(waitingShot.data,'base64'));
  // The same native toggle works with the keyboard, and a refresh keeps its state.
  await evaluate("document.querySelector('.sidebar-toggle').focus()");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await evaluate("document.querySelector('.sidebar-toggle').getAttribute('aria-label')"),'Expand sidebar');
  assert.equal(await evaluate("document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')"),'false');
  assert.ok(await evaluate("document.querySelector('.layout').getBoundingClientRect().left") < expandedLeft);
  assert.equal(await evaluate("localStorage.getItem('fermentor.sidebarCollapsed')"),'true');
  await call('Page.reload');await new Promise(r=>setTimeout(r,700));
  assert.equal(await evaluate("document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')"),'false');
  assert.equal(await evaluate('window.__usbRequests'),0);
  await evaluate("document.querySelector('.sidebar-toggle').click()");
  await evaluate("[...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='Connect USB').click()");
  await new Promise(r=>setTimeout(r,900));
  assert.equal(await evaluate('window.__openOptions.baudRate'),115200);
  assert.equal(await evaluate('window.__usbChooserOptions'),null);
  assert.equal(await evaluate("document.querySelector('.serial-monitor-stats').innerText.includes('0 bytes')"),true);
  assert.equal(await evaluate("document.querySelector('.topbar').innerText.includes('Device waiting')"),true);
  await evaluate("window.__usbEmit('Boot diagnostic: waiting for firmware');");
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await evaluate("document.querySelector('.serial-monitor .console-screen').innerText.includes('Boot diagnostic')"),true);
  assert.equal(await evaluate("document.querySelector('.serial-monitor-hint').innerText.includes('no sensor block')"),true);
  await evaluate("window.__noReload='kept';{const select=document.querySelector('#serial-baud-rate');select.value='57600';select.dispatchEvent(new Event('change',{bubbles:true}));}");
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await evaluate('window.__openOptions.baudRate'),115200,'Selecting does not change the live port until Apply');
  assert.equal(await evaluate("document.querySelector('#serial-baud-help').innerText.includes('Apply to use 57600')"),true);
  await evaluate("document.querySelector('.serial-settings-controls button').click()");
  await new Promise(r=>setTimeout(r,150));
  assert.deepEqual(await evaluate('window.__usbOpens'),[115200,57600]);
  assert.equal(await evaluate('window.__usbRequests'),1,'Refresh reuses the existing permission/port');
  assert.equal(await evaluate('window.__noReload'),'kept');
  assert.equal(await evaluate("document.querySelector('.serial-monitor-stats').innerText.includes('57600 baud selected')"),true);
  assert.equal(await evaluate("document.querySelector('.serial-monitor-stats').innerText.includes('0 bytes')"),true);
  await evaluate('window.__usbStreaming=true');
  await new Promise(r=>setTimeout(r,650));
  assert.equal(await evaluate("document.querySelectorAll('.gauge-value').length"),5);
  assert.equal(await evaluate("document.querySelector('.topbar').innerText.includes('Device live')"),true);
  assert.equal(await evaluate("document.querySelector('.gauge-reading').textContent.includes('28.55')"),true);
  assert.equal(await evaluate('window.__usbWrites.length'),0);
  assert.equal(await evaluate("document.querySelector('.topbar').innerText.includes('Storage API offline')"),true);
  await evaluate("window.__apiOffline=false;[...document.querySelectorAll('.topbar button')].find(b=>b.textContent.trim()==='Refresh').click()");
  await evaluate("document.querySelector('.mixer-confirm input').click()");
  await evaluate("document.querySelector('.mixer-actions .btn-primary').click()");
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await evaluate("document.querySelector('.mixer-result').innerText.includes('Confirmed by ESP32')"),true);
  await evaluate("document.querySelector('.mixer-actions .btn-danger-sm').click()");
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await evaluate('window.__usbWrites.length'),2);
  assert.equal(await evaluate("document.querySelector('.mixer-overview').innerText.includes('Paused')"),true);
  await evaluate("document.querySelector('.recording-actions .btn-primary').click()");
  await evaluate("[...document.querySelectorAll('.serial-monitor button')].find(b=>b.textContent==='Pause display').click()");
  const pausedOutput=await evaluate("document.querySelector('.serial-monitor .console-screen').innerText");
  const countersBefore=await evaluate("document.querySelector('.serial-monitor-stats').innerText");
  await evaluate("document.querySelector('.sidebar-toggle').click()");
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await evaluate("document.querySelector('.serial-monitor .console-screen').innerText"),pausedOutput,'Collapse must not remount or unpause the serial monitor');
  await evaluate("document.querySelector('.sidebar-toggle').click()");
  await evaluate("{const select=document.querySelector('#serial-baud-rate');select.value='9600';select.dispatchEvent(new Event('change',{bubbles:true}));}");
  await new Promise(r=>setTimeout(r,100));
  await evaluate("document.querySelector('.serial-settings-controls button').click()");
  await new Promise(r=>setTimeout(r,4400));
  assert.equal(await evaluate("document.querySelector('.serial-monitor .console-screen').innerText"),pausedOutput);
  assert.notEqual(await evaluate("document.querySelector('.serial-monitor-stats').innerText"),countersBefore);
  assert.equal(await evaluate('window.__usbRequests'),1);
  assert.equal(await evaluate('window.__usbWrites.length'),2);
  assert.equal(await evaluate('window.__openOptions.baudRate'),9600);
  assert.equal(await evaluate('window.__noReload'),'kept');
  assert.equal(await evaluate("localStorage.getItem('fermentor.serialBaudRate')"),'9600');
  console.log('ACTIVE',await evaluate("document.querySelector('.recording-panel').innerText"));
  assert.equal(await evaluate("window.__captureOptions.audio"),false);
  const during=fs.readdirSync(output);assert.equal(during.length,1);
  const metaDuring=JSON.parse(fs.readFileSync(path.join(output,during[0],'meta.json'),'utf8'));
  assert.ok(metaDuring.videoBytes>0,'video must be written before stop');assert.ok(metaDuring.sampleCount>0);
  await evaluate("document.querySelector('.recording-actions .btn-danger-sm').click()");
  for(let i=0;i<40;i++){if(await evaluate("document.querySelector('.recording-panel .status-badge').textContent")==='Saved')break;await new Promise(r=>setTimeout(r,200));}
  const meta=JSON.parse(fs.readFileSync(path.join(output,during[0],'meta.json'),'utf8'));
  assert.equal(meta.state,'complete');assert.ok(meta.videoParts>=2);assert.ok(meta.sampleCount>=4);
  const csv=fs.readFileSync(path.join(output,during[0],'session.csv'),'utf8');
  assert.ok(csv.includes(',sensor,'));assert.ok(csv.includes(',mixer,'));assert.ok(csv.includes('mixer_target_rpm'));assert.ok(csv.includes('ph_mv'));
  const info=await evaluate(`new Promise((resolve,reject)=>{const v=document.createElement('video');v.muted=true;v.onloadeddata=()=>{v.play().then(()=>setTimeout(()=>{resolve({width:v.videoWidth,height:v.videoHeight,time:v.currentTime});v.pause();v.remove();},400)).catch(reject);};v.onerror=()=>reject('video decode failed');v.src='${origin}/records/${during[0]}/${meta.videoFile}';document.body.appendChild(v);})`,true);
  assert.equal(info.width,640);assert.ok(info.time>0);
  await evaluate("[...document.querySelectorAll('.serial-monitor button')].find(b=>b.textContent==='Clear view').click()");
  assert.equal(await evaluate("document.querySelector('.serial-monitor .console-screen').innerText.includes('View cleared')"),true);
  await evaluate("[...document.querySelectorAll('.serial-monitor button')].find(b=>b.textContent==='Resume display').click()");
  await new Promise(r=>setTimeout(r,650));
  assert.equal(await evaluate("document.querySelector('.serial-monitor .console-screen').innerText.includes('SHT30 RH')"),true);
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(root,'usb-dashboard-desktop.png'),Buffer.from(shot.data,'base64'));
  await evaluate("document.querySelector('.sidebar-toggle').click()");
  await new Promise(r=>setTimeout(r,100));
  const collapsedShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(root,'dashboard-monitor-collapsed.png'),Buffer.from(collapsedShot.data,'base64'));
  for(const width of [1920,1280,1024,768,390,360]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
    for(const collapsed of [false,true]) {
      await evaluate(`if(document.querySelector('.sidebar').dataset.collapsed !== '${collapsed}') document.querySelector('.sidebar-toggle').click()`);
      await new Promise(r=>setTimeout(r,50));
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,`No horizontal overflow at ${width}px, collapsed=${collapsed}`);
      assert.equal(await evaluate("document.querySelectorAll('.dashboard-gauges .gauge-card').length"),9);
      assert.equal(await evaluate("document.querySelector('.sidebar-toggle').getBoundingClientRect().right <= innerWidth"),true,'Toggle stays reachable');
    }
  }
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  const mobileShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(root,'dashboard-monitor-mobile.png'),Buffer.from(mobileShot.data,'base64'));
  assert.equal(await evaluate('window.__usbRequests'),1);
  assert.equal(await evaluate('window.__usbWrites.length'),2);
  console.log('PASS restored monitor layout, right-hand serial monitor, keyboard sidebar toggle, persisted preference, responsive widths and uninterrupted USB/recording.');
  console.log('PASS native video decoding/playback and matching CSV:',JSON.stringify({output,meta,playback:info,mobileOverflow:false}));

  await evaluate("location.hash='#console'");
  await new Promise(r=>setTimeout(r,150));
  assert.equal(await evaluate("document.querySelector('.console-screen').innerText.includes('SHT30 RH')"),true);
  assert.equal(await evaluate("document.body.innerText.includes('Send test frame')"),false);
  await evaluate("[...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='Disconnect USB').click()");
  await new Promise(r=>setTimeout(r,150));
  assert.equal(await evaluate('window.__usbClosed'),true);
  assert.equal(await evaluate("document.querySelector('.topbar').innerText.includes('USB disconnected')"),true);
  await evaluate("[...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='Connect USB').click()");
  await new Promise(r=>setTimeout(r,650));
  assert.equal(await evaluate('window.__usbRequests'),2);
  assert.equal(await evaluate('window.__openOptions.baudRate'),9600,'Later Connect USB uses the selected rate');
  assert.equal(await evaluate('window.__usbWrites.length'),2);
  assert.equal(await evaluate('window.__wsCount'),0);
  console.log('PASS direct USB: explicit permission, fragmented readings, live gauges, USB mixer ACKs, serial console, disconnect/reconnect without command replay, zero WebSocket connections.');
  await evaluate("location.hash='#dashboard'"); await new Promise(r=>setTimeout(r,100));
  await evaluate("window.__failNextOpen=true;document.querySelector('.serial-settings-controls button').click()");
  await new Promise(r=>setTimeout(r,150));
  assert.equal(await evaluate("document.querySelector('.serial-settings-error').innerText.includes('Simulated driver rejected baud rate')"),true);
  assert.equal(await evaluate("document.querySelector('.topbar').innerText.includes('USB disconnected')"),true);
  assert.equal(await evaluate('window.__usbWrites.length'),2);
  assert.equal(await evaluate('window.__usbRequests'),2);
  console.log('PASS selectable baud, apply/reopen on same port, recording continuity, no page reload, persisted rate and visible reconnect failure.');

  // Regression: replay the user's actual CSV and next headerless cycle rather
  // than only the original Rust format. No device or hardware writes are used.
  const reported=require('../src/shared/fixtures/reported-cycle.json');
  await evaluate("window.__usbStreaming=false;[...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='Connect USB').click()");
  await new Promise(r=>setTimeout(r,150));
  await evaluate(`window.__usbEmit(${JSON.stringify(reported.csv)})`);
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await evaluate("document.querySelectorAll('.gauge-value').length"),9,'Reported DATA row must populate all nine gauges');
  assert.equal(await evaluate("document.querySelector('.serial-monitor-stats').innerText.includes('1 frames')"),true);
  await evaluate(`window.__usbEmit(${JSON.stringify(reported.lines.join('\n'))})`);
  await new Promise(r=>setTimeout(r,100));
  const gaugeValues=await evaluate("Object.fromEntries([...document.querySelectorAll('.gauge-card')].map(card=>[card.querySelector('.gauge-title').textContent,card.querySelector('.gauge-value')?.textContent]))");
  assert.deepEqual(gaugeValues,{'Chamber T':'24.89','Chamber RH':'61.30','Coffee T':'24.38',CO2:'0',Oxygen:'21.57',pH:'6.38',Pressure:'2.280','SCD41 T':'25.28','SCD41 RH':'71.10'});
  assert.equal(await evaluate("document.querySelector('.serial-monitor-stats').innerText.includes('2 frames')"),true);
  assert.equal(await evaluate("document.querySelector('.telemetry-details').innerText.includes('1609.5 mV')"),true);
  assert.equal(await evaluate("document.querySelector('.telemetry-details').innerText.includes('1.260 V')"),true);
  assert.equal(await evaluate("[...document.querySelectorAll('.trend-svg [data-series]')].every(series=>series.querySelector('circle'))"),true,'Every chart series receives the reported sensor values');
  const historyBeforeCsv=await evaluate("document.querySelector('.dashboard-trends .muted').textContent");
  await evaluate("window.__usbEmit('DATA,306,24.38,6.38,2.280,21.57,0,25.28,71.1,24.89,61.3,0')");
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await evaluate("document.querySelector('.serial-monitor-stats').innerText.includes('2 frames')"),true,'Text/CSV counterpart must not duplicate frames');
  assert.equal(await evaluate("document.querySelector('.dashboard-trends .muted').textContent"),historyBeforeCsv);
  assert.equal(await evaluate('window.__usbWrites.length'),2,'Parsing must not send motor commands');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await evaluate('scrollTo(0,0)');
  const parsedShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(root,'dashboard-reported-readings.png'),Buffer.from(parsedShot.data,'base64'));
  console.log('PASS actual reported cycle + DATA row: all nine gauges, all chart series, correct ADC voltages and no duplicate sample.');
  assert.deepEqual(browserErrors,[]);
  await call('Browser.close');clearTimeout(deadline);
})().catch(e=>{console.error(e);process.exitCode=1;clearTimeout(deadline);}).finally(()=>{socket?.close();browser?.kill();server?.close();});
