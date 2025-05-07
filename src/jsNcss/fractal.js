/* fractal.js – 2025-04-30-psychedelic (Tricorn removed, styling kept) */

const canvas = document.getElementById('fractalCanvas');
const ctx    = canvas.getContext('2d');
const dpr    = window.devicePixelRatio || 1;

/* ------------ canvas sizing ------------ */
function resizeCanvas(){
    const {clientWidth:w, clientHeight:h} = canvas.parentElement;

    // update canvas dimensions
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    // Set actual canvas dimensions w device pixel ratio
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    // Rerender
    scheduleRender();
}

// Ensure we resize on load and whenever the window changes
addEventListener('resize', resizeCanvas);

/* ------------ UI elements ------------ */
const $=id=>document.getElementById(id);
const iterIn=$('iter'), zoomIn=$('zoom'), cxField=$('centerX'), cyField=$('centerY');
const paletteIn=$('palette'), cyclesIn=$('cycles'), formulaIn=$('formula');
const resetBtn=$('resetBtn'), dlBtn=$('downloadBtn');

const state={
    baseIter:+iterIn.value,  zoomExp:+zoomIn.value,
    cx:-0.75,  cy:0,
    palette:paletteIn.value, cycles:+cyclesIn.value,
    formula:formulaIn.value,
    // Track last mouse position for zooming
    lastMouseX: null,
    lastMouseY: null
};

let generation=0;

/* ------------ worker pool ------------ */
const TILE=96;
const MAX_WORKERS=Math.min(navigator.hardwareConcurrency||4,8);
const freeWorkers=[], taskQueue=[];

/* --- inline worker (Tricorn branch removed) --- */
const workerSrc=String.raw`
self.onmessage=e=>{
  const{gen,tx,ty,w,h,cx,cy,zoomExp,baseIter,palette,cycles,formula,dpr,canvasW,canvasH}=e.data;
  const span=3/10**zoomExp;
  const aspectRatio = canvasW / canvasH;
  
  // Adjust scale calculation to account for aspect ratio
  let scale;
  if (aspectRatio >= 1) {
    // Width >= height, base scale on height
    scale = span / canvasH / dpr;
  } else {
    // Height > width, base scale on width
    scale = span / canvasW / dpr;
  }

  const maxIt=Math.max(baseIter,
    Math.floor(200*(1.3**Math.min(zoomExp,8))+50*Math.max(zoomExp-8,0)));

  const hsl=(h,s,l)=>{h/=360;s/=100;l/=100;
    const k=n=>(n+h)%1,a=s*Math.min(l,1-l);
    const f=n=>{const t=k(n);return l-a*Math.max(-1,Math.min(t*6-3,4-t*6,1));};
    return[f(0)*255,f(8/12)*255,f(4/12)*255];};
  const rgba32=(r,g,b,a=255)=>(a<<24)|(b<<16)|(g<<8)|r;

  const color=i=>{
    if(i===maxIt)return[20,20,20];
    const hue=((i*cycles/maxIt)*360)%360;
    switch(palette){
      case'fire'  :return[255,50+205*(hue/360),0];
      case'ice'   :return[0,120+135*(hue/360),255];
      case'forest':return hsl(120-60*(hue/360),80,35+25*(hue/360));
      default     :return hsl(hue,90,50);
    }
  };

  const inBulbs=(x,y)=>(x+1)**2+y*y<0.0625||
    (()=>{const dx=x-0.25,q=dx*dx+y*y;return q<=0.25*(q+dx);})();

  function iterate(x0,y0){
    let x=0,y=0,x2=0,y2=0,i=0;
    switch(formula){
      case'multibrot3': /* z -> z³ + c */
        while(x2+y2<=4&&i<maxIt){
          const xT=x*(x2-3*y2)+x0;
          const yT=y*(3*x2-y2)+y0;
          x=xT;y=yT;x2=x*x;y2=y*y;i++;
        } break;

      case'burningShip':
        while(x2+y2<=4&&i<maxIt){
          const xT=x2 - y2 + x0;
          const yT=2*x*y + y0;
          x=Math.abs(xT); y=Math.abs(yT);
          x2=x*x;y2=y*y;i++;
        } break;

      default: /* Mandelbrot */
        if(inBulbs(x0,y0))return maxIt;
        while(x2+y2<=4&&i<maxIt){
          y=2*x*y+y0;
          x=x2 - y2 + x0;
          x2=x*x;y2=y*y;i++;
        }
    }
    return i;
  }

  const buf=new Uint32Array(w*h); let p=0;
  
  // Calculate correct startX and startY based on aspect ratio
  let spanX, spanY;
  if (aspectRatio >= 1) {
    // Wider than tall - adjust X span
    spanY = span;
    spanX = span * aspectRatio;
  } else {
    // Taller than wide - adjust Y span
    spanX = span;
    spanY = span / aspectRatio;
  }
  
  const startX = cx - spanX/2 + tx * scale;
  const startY = cy - spanY/2 + ty * scale;
  
  for(let py=0;py<h;py++){
    const y0=startY+py*scale;
    for(let px=0;px<w;px++){
      const x0=startX+px*scale;
      buf[p++]=rgba32(...color(iterate(x0,y0)));
    }
  }
  self.postMessage({gen,x:tx,y:ty,w,h,buf:buf.buffer},[buf.buffer]);
};`;

function makeWorker(){
    const w=new Worker(URL.createObjectURL(new Blob([workerSrc],{type:'application/javascript'})));
    w.onmessage=({data})=>{
        if(data.gen===generation){
            const img=new ImageData(new Uint8ClampedArray(data.buf),data.w,data.h);
            ctx.putImageData(img,data.x,data.y);
        }
        freeWorkers.push(w); dispatch();
    };
    return w;
}
for(let i=0;i<MAX_WORKERS;i++) freeWorkers.push(makeWorker());

function dispatch(){
    while(freeWorkers.length&&taskQueue.length)
        freeWorkers.pop().postMessage(taskQueue.shift());
}

/* ------------ rendering ------------ */
// Calculate span based on zoom and aspect ratio
function getSpan() {
    const baseSpan = 3/10**state.zoomExp;
    const aspectRatio = canvas.width / canvas.height;

    // Return both X and Y spans
    if (aspectRatio >= 1) {
        return {
            x: baseSpan * aspectRatio,
            y: baseSpan
        };
    } else {
        return {
            x: baseSpan,
            y: baseSpan / aspectRatio
        };
    }
}

function scheduleRender(){
    if(!canvas.width)return;
    generation++; taskQueue.length=0;
    ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height);

    const W=canvas.width, H=canvas.height;
    for(let y=0;y<H;y+=TILE){
        for(let x=0;x<W;x+=TILE){
            const w=Math.min(TILE,W-x), h=Math.min(TILE,H-y);
            taskQueue.push({gen:generation,tx:x,ty:y,w,h,
                cx:state.cx, cy:state.cy, zoomExp:state.zoomExp,
                baseIter:state.baseIter, palette:state.palette,
                cycles:state.cycles, formula:state.formula,
                dpr, canvasW:W, canvasH:H});
        }
    }
    dispatch();
}

/* ------------ UI sync ------------ */
function syncFromInputs(){
    state.baseIter=+iterIn.value||500;
    state.zoomExp=+zoomIn.value||0;
    state.palette=paletteIn.value;
    state.cycles=+cyclesIn.value||4;
    state.formula=formulaIn.value;

    iterIn.value=state.baseIter;
    zoomIn.value=state.zoomExp.toFixed(1);
    cxField.value=state.cx.toFixed(6);
    cyField.value=state.cy.toFixed(6);

    scheduleRender();
}
[iterIn,zoomIn,paletteIn,cyclesIn,formulaIn]
    .forEach(el=>el.addEventListener('change',syncFromInputs));

/* ------------ interactions ------------ */
// Track mouse position for zooming toward cursor
canvas.addEventListener('mousemove', e => {
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
});

// Zoom towards mouse position
function zoomAt(direction, x, y) {
    // Calculate how much to zoom
    const oldZoom = state.zoomExp;
    const zoomDelta = 0.2 * direction; // Positive for zoom in, negative for zoom out
    state.zoomExp = Math.max(0, Math.min(15, +(state.zoomExp + zoomDelta).toFixed(1)));

    // If zoom level actually changed and we have a valid mouse position
    if (state.zoomExp !== oldZoom && x !== null && y !== null) {
        const r = canvas.getBoundingClientRect();

        // Calculate relative position within canvas (0 to 1)
        const relX = (x - r.left) / r.width;
        const relY = (y - r.top) / r.height;

        // Get spans before and after zoom
        const oldSpan = getSpan();
        const newSpan = getSpan();

        // Calculate how much to adjust center
        const centerXOffset = (oldSpan.x - newSpan.x) * (relX - 0.5);
        const centerYOffset = (oldSpan.y - newSpan.y) * (relY - 0.5);

        // Apply offset to center
        state.cx += centerXOffset;
        state.cy += centerYOffset;
    }

    // Update UI and render
    zoomIn.value = state.zoomExp;
    cxField.value = state.cx.toFixed(6);
    cyField.value = state.cy.toFixed(6);
    scheduleRender();
}

// Double-click centers at mouse position
canvas.addEventListener('dblclick', e => {
    const r = canvas.getBoundingClientRect();
    const span = getSpan();

    // Calculate exact position in fractal coordinates
    const relX = (e.clientX - r.left) / r.width;
    const relY = (e.clientY - r.top) / r.height;

    // Move from edges (0,0) to center (0.5,0.5) then scale by span
    state.cx += (relX - 0.5) * span.x;
    state.cy += (relY - 0.5) * span.y;

    // Update UI fields and render
    cxField.value = state.cx.toFixed(6);
    cyField.value = state.cy.toFixed(6);
    scheduleRender();
});

resetBtn.addEventListener('click', () => {
    iterIn.value = 500;
    zoomIn.value = 0;
    cyclesIn.value = 4;
    state.cx = -0.75;
    state.cy = 0;
    paletteIn.value = 'classic';
    formulaIn.value = 'mandelbrot';
    syncFromInputs();
});

dlBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = 'fractal.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
});

// Key handling for navigation and zoom
addEventListener('keydown', e => {
    const dir = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
    };

    if (e.key in dir) {
        e.preventDefault();
        const [dx, dy] = dir[e.key];
        const span = getSpan();
        const stepX = span.x * 0.025;
        const stepY = span.y * 0.025;

        state.cx += dx * stepX;
        state.cy += dy * stepY;

        cxField.value = state.cx.toFixed(6);
        cyField.value = state.cy.toFixed(6);
        scheduleRender();
    } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        zoomAt(1, state.lastMouseX, state.lastMouseY); // Zoom in
    } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        zoomAt(-1, state.lastMouseX, state.lastMouseY); // Zoom out
    }
});

/* ------------ tutorial modal ------------ */
const modal = $('tutorialModal'), closeTut = $('closeTutorial');
function maybeShowTutorial(){
    if (!localStorage.getItem('tutorialSeen'))
        modal.classList.add('show');
}
closeTut.addEventListener('click', () => {
    modal.classList.remove('show');
    localStorage.setItem('tutorialSeen', '1');
});

/* ------------ boot ------------ */
addEventListener('load', () => {
    resizeCanvas();
    syncFromInputs();
    maybeShowTutorial();
});
