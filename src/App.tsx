/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Results } from '@mediapipe/hands';
import { HandTracker } from './components/HandTracker';
import { COLORS, BRUSH_SIZES, GESTURE_GUIDE } from './constants';
import { StatusMode, Point } from './types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Eraser, 
  Trash2, 
  Download, 
  Sparkles, 
  Hand,
  Square,
  Settings,
  Info,
  Layers,
  Activity
} from 'lucide-react';
import { GeminiLiveAssistant } from './lib/geminiLive';

export default function App() {
  const [status, setStatus] = useState<StatusMode>('none');
  const [selColor, setSelColor] = useState(0);
  const [selBrush, setSelBrush] = useState(1);
  const [mode, setMode] = useState<'free' | 'shape'>('free');
  const [isAiEnabled, setIsAiEnabled] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const wCvsRef = useRef<HTMLCanvasElement>(null);
  const dCvsRef = useRef<HTMLCanvasElement>(null);
  const previewCvsRef = useRef<HTMLCanvasElement>(null);
  const cCvsRef = useRef<HTMLCanvasElement>(null);
  const aiRef = useRef<GeminiLiveAssistant | null>(null);

  const prevPtRef = useRef<Point | null>(null);
  const smoothBufRef = useRef<Point[]>([]);
  const shapeStartRef = useRef<Point | null>(null);

  // Initialize Gemini AI
  useEffect(() => {
    if (isAiEnabled && !aiRef.current) {
      const assistant = new GeminiLiveAssistant(process.env.GEMINI_API_KEY!);
      assistant.connect({
        onMessage: (text) => setAiMessage(text),
      }).then(() => {
        aiRef.current = assistant;
      });
    } else if (!isAiEnabled && aiRef.current) {
      aiRef.current.disconnect();
      aiRef.current = null;
    }
  }, [isAiEnabled]);

  // AI Visual Loop
  useEffect(() => {
    if (!isAiEnabled || !aiRef.current) return;
    
    const interval = setInterval(() => {
      if (dCvsRef.current && aiRef.current) {
        const canvas = dCvsRef.current;
        const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
        aiRef.current.sendFrame(base64);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isAiEnabled]);

  const resize = useCallback(() => {
    [wCvsRef, dCvsRef, previewCvsRef, cCvsRef].forEach(ref => {
      if (ref.current) {
        ref.current.width = window.innerWidth;
        ref.current.height = window.innerHeight;
      }
    });
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  const clearCanvas = () => {
    const ctx = dCvsRef.current?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    prevPtRef.current = null;
  };

  const saveDrawing = () => {
    const tmp = document.createElement('canvas');
    tmp.width = window.innerWidth;
    tmp.height = window.innerHeight;
    const tCtx = tmp.getContext('2d');
    if (!tCtx) return;
    
    if (wCvsRef.current) tCtx.drawImage(wCvsRef.current, 0, 0);
    if (dCvsRef.current) tCtx.drawImage(dCvsRef.current, 0, 0);

    const a = document.createElement('a');
    a.download = `vision-draw-${Date.now()}.png`;
    a.href = tmp.toDataURL('image/png');
    a.click();
  };

  const smoothPt = (x: number, y: number): Point => {
    smoothBufRef.current.push({ x, y });
    if (smoothBufRef.current.length > 5) smoothBufRef.current.shift();
    const sx = smoothBufRef.current.reduce((a, b) => a + b.x, 0) / smoothBufRef.current.length;
    const sy = smoothBufRef.current.reduce((a, b) => a + b.y, 0) / smoothBufRef.current.length;
    return { x: Math.round(sx), y: Math.round(sy) };
  };

  const fingerUp = (lm: any) => {
    const tips = [8, 12, 16, 20];
    const pips = [6, 10, 14, 18];
    return tips.map((t, i) => lm[t].y < lm[pips[i]].y);
  };

  const onResults = useCallback((res: Results) => {
    const wCtx = wCvsRef.current?.getContext('2d');
    const cCtx = cCvsRef.current?.getContext('2d');
    const dCtx = dCvsRef.current?.getContext('2d');
    if (!wCtx || !cCtx || !dCtx) return;

    const W = window.innerWidth;
    const H = window.innerHeight;

    wCtx.save();
    wCtx.translate(W, 0);
    wCtx.scale(-1, 1);
    wCtx.drawImage(res.image, 0, 0, W, H);
    wCtx.restore();

    cCtx.clearRect(0, 0, W, H);

    if (!res.multiHandLandmarks?.length) {
      setStatus('none');
      prevPtRef.current = null;
      smoothBufRef.current = [];
      return;
    }

    const lm = res.multiHandLandmarks[0];
    const rawX = (1 - lm[8].x) * W;
    const rawY = lm[8].y * H;
    const pos = smoothPt(rawX, rawY);
    setCoords(pos);

    const up = fingerUp(lm);
    const nUp = up.filter(Boolean).length;

    if (nUp >= 3) {
      setStatus('clear');
      clearCanvas();
      drawCursor(cCtx, pos.x, pos.y, '#f43f5e'); // rose-500
      return;
    }

    if (up[0] && !up[1]) {
      setStatus('draw');
      const col = COLORS[selColor];
      const size = BRUSH_SIZES[selBrush];

      if (col.hex === 'eraser') {
        dCtx.globalCompositeOperation = 'destination-out';
        dCtx.lineWidth = size * 5;
      } else {
        dCtx.globalCompositeOperation = 'source-over';
        dCtx.lineWidth = size;
        dCtx.strokeStyle = col.hex;
        dCtx.lineCap = 'round';
        dCtx.lineJoin = 'round';
      }

      if (prevPtRef.current) {
        dCtx.beginPath();
        dCtx.moveTo(prevPtRef.current.x, prevPtRef.current.y);
        dCtx.lineTo(pos.x, pos.y);
        dCtx.stroke();
      }
      prevPtRef.current = pos;
      drawCursor(cCtx, pos.x, pos.y, col.hex === 'eraser' ? '#fff' : col.hex);
    } else if (up[0] && up[1]) {
      setStatus('pause');
      prevPtRef.current = null;
      drawCursor(cCtx, pos.x, pos.y, '#eab308'); // yellow-400
    } else {
      setStatus('none');
      prevPtRef.current = null;
    }
  }, [selColor, selBrush]);

  const drawCursor = (ctx: CanvasRenderingContext2D, x: number, y: number, color: string) => {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Inner dot
    ctx.beginPath();
    ctx.arc(x, y, 1, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    // Pulse effect
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.strokeStyle = color + '44';
    ctx.stroke();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (mode !== 'shape') return;
    shapeStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (mode !== 'shape' || !shapeStartRef.current) return;
    const ctx = previewCvsRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const x = Math.min(e.clientX, shapeStartRef.current.x);
    const y = Math.min(e.clientY, shapeStartRef.current.y);
    const w = Math.abs(e.clientX - shapeStartRef.current.x);
    const h = Math.abs(e.clientY - shapeStartRef.current.y);

    ctx.strokeStyle = COLORS[selColor].hex === 'eraser' ? '#fff' : COLORS[selColor].hex;
    ctx.lineWidth = BRUSH_SIZES[selBrush];
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (mode !== 'shape' || !shapeStartRef.current) return;
    const dCtx = dCvsRef.current?.getContext('2d');
    const pCtx = previewCvsRef.current?.getContext('2d');
    if (!dCtx || !pCtx) return;

    pCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const x = Math.min(e.clientX, shapeStartRef.current.x);
    const y = Math.min(e.clientY, shapeStartRef.current.y);
    const w = Math.abs(e.clientX - shapeStartRef.current.x);
    const h = Math.abs(e.clientY - shapeStartRef.current.y);

    const col = COLORS[selColor];
    if (col.hex === 'eraser') {
      dCtx.globalCompositeOperation = 'destination-out';
    } else {
      dCtx.globalCompositeOperation = 'source-over';
      dCtx.strokeStyle = col.hex;
      dCtx.lineWidth = BRUSH_SIZES[selBrush];
      dCtx.strokeRect(x, y, w, h);
    }
    shapeStartRef.current = null;
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-200 border-8 border-slate-900 overflow-hidden select-none font-sans"
         onMouseDown={handleMouseDown}
         onMouseMove={handleMouseMove}
         onMouseUp={handleMouseUp}
    >
      <video ref={videoRef} className="hidden" playsInline autoPlay muted />
      <HandTracker onResults={onResults} videoRef={videoRef} />

      {/* Header Navigation */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-cyan-500 rounded-sm rotate-45 flex items-center justify-center">
            <span className="text-slate-950 font-bold -rotate-45">V</span>
          </div>
          <h1 className="text-xl font-bold tracking-widest text-white uppercase">
            VisionDraw <span className="text-cyan-400 font-normal">v2.0</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setIsAiEnabled(!isAiEnabled)}
            className={`flex items-center gap-2 px-3 py-1 border rounded-sm transition-all ${
              isAiEnabled ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-slate-800/50 border-slate-700 text-slate-500'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${isAiEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}></div>
            <span className="text-[10px] font-mono uppercase tracking-tighter">
              Live API: {isAiEnabled ? 'Active' : 'Inactive'}
            </span>
          </button>
          <div className="h-6 w-px bg-slate-800"></div>
          <div className="text-[10px] font-mono text-slate-500 flex gap-4">
            <span>COORD: <span className="text-cyan-400">{coords.x}, {coords.y}</span></span>
            <span>FPS: <span className="text-cyan-400">60</span></span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col p-6 gap-8 shrink-0">
          <section>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-4 font-bold">Drawing Modes</h2>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => setMode('free')}
                className={`flex flex-col items-center justify-center gap-2 p-3 rounded-sm transition-all ${
                  mode === 'free' ? 'bg-cyan-500/10 border border-cyan-500/50 text-cyan-400' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <Hand className="w-5 h-5" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Pen</span>
              </button>
              <button 
                onClick={() => setMode('shape')}
                className={`flex flex-col items-center justify-center gap-2 p-3 rounded-sm transition-all ${
                  mode === 'shape' ? 'bg-cyan-500/10 border border-cyan-500/50 text-cyan-400' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <Square className="w-5 h-5" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Rect</span>
              </button>
            </div>
          </section>

          <section>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-4 font-bold">Color Palette</h2>
            <div className="grid grid-cols-4 gap-2">
              {COLORS.map((c, i) => (
                <button 
                  key={c.name}
                  onClick={() => setSelColor(i)}
                  className={`w-10 h-10 rounded-sm cursor-pointer transition-all ${
                    selColor === i ? 'border-2 border-white scale-105 shadow-[0_0_10px_rgba(255,255,255,0.2)]' : 'border border-transparent'
                  }`}
                  style={{ backgroundColor: c.hex === 'eraser' ? '#1e293b' : c.hex }}
                  title={c.name}
                >
                  {c.hex === 'eraser' && <Eraser className="w-4 h-4 mx-auto text-slate-400" />}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-4 font-bold">Brush Scale</h2>
            <div className="flex gap-2">
              {BRUSH_SIZES.map((size, i) => (
                <button
                  key={size}
                  onClick={() => setSelBrush(i)}
                  className={`flex-1 aspect-square rounded-sm border transition-all flex items-center justify-center ${
                    selBrush === i ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400' : 'bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-800'
                  }`}
                >
                  <div style={{ width: `${Math.min(size, 16)}px`, height: `${Math.min(size, 16)}px` }} className="rounded-full bg-current" />
                </button>
              ))}
            </div>
          </section>

          <div className="mt-auto space-y-2">
            <button 
              onClick={saveDrawing}
              className="w-full py-3 bg-white text-slate-950 font-bold uppercase tracking-tighter rounded-sm hover:bg-cyan-400 transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" /> Save Capture
            </button>
            <button 
              onClick={clearCanvas}
              className="w-full py-3 border border-rose-500/50 text-rose-500 font-bold uppercase tracking-tighter rounded-sm hover:bg-rose-500/10 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Clear Space
            </button>
          </div>
        </aside>

        {/* Viewport Area */}
        <div className="flex-1 relative bg-black overflow-hidden">
          <canvas ref={wCvsRef} className="absolute inset-0 z-0 w-full h-full opacity-30 grayscale brightness-50" />
          <canvas ref={dCvsRef} className="absolute inset-0 z-10 w-full h-full" />
          <canvas ref={previewCvsRef} className="absolute inset-0 z-20 w-full h-full pointer-events-none" />
          <canvas ref={cCvsRef} className="absolute inset-0 z-30 w-full h-full pointer-events-none" />

          {/* Interactive UI Layers */}
          <div className="absolute inset-0 p-8 flex flex-col justify-between pointer-events-none">
            <div className="flex justify-between items-start">
              <div className="p-4 border-l-4 border-cyan-500 bg-slate-900/80 backdrop-blur-md">
                <div className="text-cyan-400 text-[10px] font-mono mb-1 uppercase tracking-widest">Tracking Status</div>
                <div className="text-white font-bold text-lg uppercase tracking-tight">
                  {status === 'none' ? 'SCANNING...' : status}
                </div>
              </div>
              
              <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-sm backdrop-blur-md">
                <div className="text-[10px] uppercase text-slate-500 tracking-widest mb-2">AI Pulse</div>
                <div className="w-32 h-16 bg-slate-950 relative overflow-hidden">
                  <div className="absolute inset-0 opacity-10 flex items-center justify-center">
                    <Activity className="w-12 h-12 text-cyan-400" />
                  </div>
                  <AnimatePresence>
                    {isAiEnabled && (
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: '100%' }}
                        className="absolute h-px bg-cyan-400 top-1/2"
                      />
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* AI Assistant Message */}
            <div className="self-center w-full max-w-xl">
              <AnimatePresence>
                {aiMessage && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="p-6 bg-slate-900/90 border-t-2 border-cyan-500 text-center font-mono text-sm tracking-wide text-cyan-100 shadow-2xl"
                  >
                    <Sparkles className="w-4 h-4 inline-block mr-3 animate-pulse text-cyan-400" />
                    "{aiMessage}"
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Gesture Overlay */}
            <div className="flex justify-center">
              <div className="bg-slate-900/90 border border-slate-700 px-8 py-4 rounded-sm flex gap-12 backdrop-blur-sm pointer-events-auto shadow-2xl">
                {GESTURE_GUIDE.map((g, idx) => (
                  <div key={idx} className="text-center group">
                    <div className="text-white font-bold mb-1 text-sm group-hover:text-cyan-400 transition-colors uppercase">
                      {g.icon} {g.text.split(' ')[0]}
                    </div>
                    <div className="text-[9px] uppercase tracking-widest text-slate-500">
                      {g.action.split(' / ')[0]}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Diagnostics */}
        <aside className="w-12 border-l border-slate-800 bg-slate-900 flex flex-col items-center py-4 gap-6 shrink-0">
          <div className="w-6 h-6 text-slate-600 hover:text-cyan-400 cursor-pointer transition-colors"><Settings className="w-full h-full" /></div>
          <div className="w-6 h-6 text-slate-600 hover:text-cyan-400 cursor-pointer transition-colors"><Info className="w-full h-full" /></div>
          <div className="w-6 h-6 text-slate-600 hover:text-cyan-400 cursor-pointer transition-colors"><Layers className="w-full h-full" /></div>
          
          <div className="mt-auto flex flex-col gap-4 mb-4">
            <div className={`w-2 h-2 rounded-full transition-colors ${status === 'draw' ? 'bg-cyan-500' : 'bg-slate-700'}`}></div>
            <div className={`w-2 h-2 rounded-full transition-colors ${mode === 'shape' ? 'bg-cyan-500' : 'bg-slate-700'}`}></div>
            <div className={`w-2 h-2 rounded-full transition-colors ${isAiEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>
          </div>
        </aside>
      </main>

      {/* Footer Info */}
      <footer className="h-8 bg-slate-900 border-t border-slate-800 flex items-center px-6 shrink-0">
        <div className="text-[9px] uppercase tracking-widest text-slate-500 flex gap-6">
          <span>System: <span className="text-emerald-400">Stable</span></span>
          <span>Latency: <span className="text-cyan-400">14ms</span></span>
          <span>API: <span className="text-slate-300">Gemini Live v3.1</span></span>
        </div>
        <div className="ml-auto text-[9px] font-mono text-slate-600">
          GEN_TIMESTAMP: {new Date().toISOString().replace('T', '_').split('.')[0]}
        </div>
      </footer>
    </div>
  );
}
