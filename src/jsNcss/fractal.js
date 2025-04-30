/* fractal.js – depth-coloured Mandelbrot explorer */

const canvas = document.getElementById('fractalCanvas');
const ctx    = canvas.getContext('2d');
const dpr    = window.devicePixelRatio || 1;

/* ── canvas sizing ── */
function resizeCanvas() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        scheduleRender();
    }
}
addEventListener('resize', resizeCanvas);

/* ── controls ── */
const $ = id => document.getElementById(id);
const iterIn  = $('iter');
const zoomIn  = $('zoom');
const cxField = $('centerX');
const cyField = $('centerY');
const paletteIn = $('palette');
const cyclesIn  = $('cycles');
const resetBtn  = $('resetBtn');
const dlBtn     = $('downloadBtn');

const state = {
    baseIter : +iterIn.value,
    zoomExp  : +zoomIn.value,
    cx       : -0.75,
    cy       : 0,
    palette  : paletteIn.value,
    cycles   : +cyclesIn.value
};

let generation = 0;

/* ── worker pool ── */
const TILE        = 128;
const MAX_WORKERS = Math.min(navigator.hardwareConcurrency || 2, 4);
const freeWorkers = [];
const taskQueue   = [];
const workerSrc = String.raw`
self.onmessage = e => {
  const { gen, tx, ty, w, h, cx, cy, zoomExp, baseIter,
          palette, cycles, dpr, canvasW, canvasH } = e.data;

  const span  = 3 / Math.pow(10, zoomExp);
  const scale = span / Math.min(canvasW, canvasH) / dpr;
  const maxIt = Math.max(baseIter, Math.ceil(150 * Math.pow(1.55, zoomExp)));

  const hsl = (h,s,l)=>{h/=360;s/=100;l/=100;
    const k=n=>(n+h)%1;const a=s*Math.min(l,1-l);
    const f=n=>{const t=k(n);return l-a*Math.max(-1,Math.min(t*6-3,4-t*6,1));};
    return [f(0)*255,f(8/12)*255,f(4/12)*255];};
  const rgba32 = (r,g,b,a=255)=>(a<<24)|(b<<16)|(g<<8)|r;

  const colour = i=>{
    if(i===maxIt) return [20,20,20];
    const hue=((i*cycles/maxIt)*360)%360;
    switch(palette){
      case'fire'  :return [255,50+205*(hue/360),0];
      case'ice'   :return [0,120+135*(hue/360),255];
      case'forest':return hsl(120-60*(hue/360),80,35+25*(hue/360));
      default     :return hsl(hue,90,50);
    }
  };

  const inBulbs=(x,y)=>(x+1)**2+y*y<0.0625||
    (()=>{const dx=x-0.25,q=dx*dx+y*y;return q<=0.25*(q+dx);})();

  const mandel=(x0,y0)=>{
    if(inBulbs(x0,y0))return maxIt;
    let x=0,y=0,x2=0,y2=0,i=0;
    while(x2+y2<=4&&i<maxIt){
      y=2*x*y+y0;
      x=x2-y2+x0;
      x2=x*x;y2=y*y;i++;
    }
    return i;
  };

  const buf=new Uint32Array(w*h);let p=0;
  const startX=cx-span/2+tx*scale;
  const startY=cy-span/2+ty*scale;
  for(let py=0;py<h;py++){
    const y0=startY+py*scale;
    for(let px=0;px<w;px++){
      const x0=startX+px*scale;
      buf[p++]=rgba32(...colour(mandel(x0,y0)));
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
        freeWorkers.push(w);dispatch();
    };
    return w;
}
for(let i=0;i<MAX_WORKERS;i++) freeWorkers.push(makeWorker());

function dispatch(){
    while(freeWorkers.length&&taskQueue.length){
        freeWorkers.pop().postMessage(taskQueue.shift());
    }
}

/* ── rendering ── */
const span = ()=>3/Math.pow(10,state.zoomExp);

function scheduleRender(){
    if(!canvas.width) return;
    generation++;
    taskQueue.length=0;
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    const W=canvas.width,H=canvas.height;
    for(let y=0;y<H;y+=TILE){
        for(let x=0;x<W;x+=TILE){
            const w=Math.min(TILE,W-x),h=Math.min(TILE,H-y);
            taskQueue.push({
                gen:generation,tx:x,ty:y,w,h,
                cx:state.cx,cy:state.cy,zoomExp:state.zoomExp,
                baseIter:state.baseIter,palette:state.palette,
                cycles:state.cycles,dpr,canvasW:W,canvasH:H
            });
        }
    }
    dispatch();
}

/* ── UI sync ── */
function syncFromInputs(){
    state.baseIter=+iterIn.value||50;
    state.zoomExp=+zoomIn.value||0;
    state.palette=paletteIn.value;
    state.cycles=+cyclesIn.value||4;
    iterIn.value=state.baseIter;
    zoomIn.value=state.zoomExp.toFixed(1);
    cxField.value=state.cx.toFixed(5);
    cyField.value=state.cy.toFixed(5);
    cyclesIn.value=state.cycles;
    scheduleRender();
}
[iterIn,zoomIn,paletteIn,cyclesIn].forEach(el=>el.addEventListener('change',syncFromInputs));

/* ── interactions ── */
canvas.addEventListener('dblclick',e=>{
    const r=canvas.getBoundingClientRect();
    const s=span()/Math.min(r.width,r.height);
    state.cx+=(e.clientX-r.left-r.width/2)*s;
    state.cy+=(e.clientY-r.top -r.height/2)*s;
    scheduleRender();
});
resetBtn.addEventListener('click',()=>{
    iterIn.value=500;zoomIn.value=0;cyclesIn.value=4;
    state.cx=-0.75;state.cy=0;paletteIn.value='classic';
    syncFromInputs();
});
dlBtn.addEventListener('click',()=>{
    const a=document.createElement('a');
    a.download='mandelbrot.png';
    a.href=canvas.toDataURL('image/png');
    a.click();
});
addEventListener('keydown',e=>{
    const arrows={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(e.key in arrows){
        e.preventDefault();
        const [dx,dy]=arrows[e.key];
        const step=span()*0.025;
        state.cx+=dx*step;state.cy+=dy*step;
        scheduleRender();
    }else if(e.key==='w'||e.key==='W'){
        e.preventDefault();state.zoomExp=Math.min(6,+(state.zoomExp+0.1).toFixed(1));scheduleRender();
    }else if(e.key==='s'||e.key==='S'){
        e.preventDefault();state.zoomExp=Math.max(0,+(state.zoomExp-0.1).toFixed(1));scheduleRender();
    }
});

/* ── boot ── */
addEventListener('load',()=>{
    resizeCanvas();
    syncFromInputs();
});
