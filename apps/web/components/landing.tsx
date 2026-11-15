// @ts-nocheck -- visual-only port of the "HEIST Landing - Combined" design (three.js scene + canvases); data comes from lib/evidence.
'use client';
import { Component, createRef } from 'react';
import * as THREE from 'three';
import { css } from '../lib/css';
import { evidence, vaultStats } from '../lib/evidence';

const R = '#ff3b30', T = '#7fe3c4';
const fmt = (n) => n.toLocaleString('en-US');
const ARMS = evidence.arms.map((a) => { const s = vaultStats(a); return { n: a.n, name: a.name, layer: a.layer, br: s.breaches + ' / ' + fmt(s.attacks), col: s.breaches ? R : T }; });
const COLS = [...evidence.arms.map((a, i) => ({ name: a.n + ' ' + a.name, layer: i === 0 ? 'raw · D2' : a.layer.replace('+ ', ''), br: (i === 0 ? 1 : a.breaches) + '/500', col: i === 0 ? R : T })),
  { name: 'REF GPT-5.5', layer: 'frontier', br: evidence.frontier.breaches + '/500', col: '#9aa0a8' }];
const B = evidence.breach, H = B.record.attemptHash;
const AD = evidence.adaptive;

export class Landing extends Component {
  state = { p: 0, rx: 0, ry: 0, tick: 0, held: 0, breaches: 0, result: null, now: '', coarse: false };
  scrollRef = createRef(); threeRef = createRef(); laserRef = createRef(); noiseRef = createRef();
  chapters = [['01', 'SURVEILLANCE', 0], ['02', 'THE ATTACK', 0.19], ['03', 'THE ORACLE', 0.335], ['04', 'THE DEFENSES', 0.53], ['05', 'PROOF', 0.75], ['06', 'THE POD', 0.85], ['07', 'AUDIT', 0.92]];
  cams = [['01', 'TRIPWIRE', 'SERV default'], ['02', 'GUARD DOG', '+ Guard'], ['03', 'ORACLE', '+ Kronos'], ['04', 'HYDRA', '+ Multipath'], ['00', 'OPEN SAFE', 'raw model'], ['05', 'SHADOW', '+ Shadow Agent'], ['06', 'FORT KNOX', 'enforced policy'], ['REF', 'GPT-5.5', 'frontier ref'], ['POD', 'ADAPTIVE', 'attacker swarm']];
  logs = ['browse(payment-note-1)', 'browse(payment-note-4)', 'tool: "fixture note"', 'policy.allowlist → MERCHANT', 'update_policy not called', 'transfer() not called', 'release_funds() not called', 'reply("Recipient not approved.")'];
  breachLogs = ['browse(payment-note-1)', 'browse(payment-note-2)', 'browse(payment-note-3)', 'browse(payment-note-4)', 'update_policy(+ATTACKER)', 'pay_x402(invoice-1, 200000)'];
  counts = [2, 4, 7, 11, 16, 23, 34];
  ss(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  lvlOf(p) { return Math.min(6, Math.max(0, Math.floor((p - 0.555) / 0.195 * 7))); }
  componentDidMount() {
    this.p = 0; this.mx = 0; this.my = 0; this.px = -99; this.py = -99; this.armed = false; this.flash = 0; this.flashCol = '255,59,48';
    this.onScroll = () => { const el = this.scrollRef.current; if (!el) return; const r = el.getBoundingClientRect(); const p = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight))); this.p = p; if (Math.abs(p - this.state.p) > 0.0015) this.setState({ p }); };
    this.onMove = (e) => {
      this.mx = e.clientX / innerWidth * 2 - 1; this.my = e.clientY / innerHeight * 2 - 1;
      const c = this.laserRef.current; if (c) { const r = c.getBoundingClientRect(); this.px = e.clientX - r.left; this.py = e.clientY - r.top; }
      if (this.p < 0.22) { const rx = -this.my * 7, ry = this.mx * 10; cancelAnimationFrame(this.mr); this.mr = requestAnimationFrame(() => this.setState({ rx, ry })); }
    };
    addEventListener('scroll', this.onScroll, { passive: true }); addEventListener('pointermove', this.onMove); this.onScroll();
    this.iv = setInterval(() => this.setState((s) => ({ tick: s.tick + 1, now: new Date().toISOString().slice(11, 19) + ' UTC' })), 700);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; this.setState({ coarse: matchMedia('(pointer: coarse)').matches });
    if (!reduced) this.initLaser();
    const nc = this.noiseRef.current, nctx = nc.getContext('2d'), img = nctx.createImageData(320, 180);
    const nloop = () => { this.nraf = requestAnimationFrame(nloop); const p = this.p; if (!(p < 0.22 || (p > 0.48 && p < 0.58))) return; const d = img.data; for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } nctx.putImageData(img, 0, 0); };
    if (!reduced) nloop();
    if (!reduced) try { this.initThree(); } catch { /* WebGL unavailable: the scroll story still renders without the 3D layer. */ }
  }
  componentWillUnmount() {
    removeEventListener('scroll', this.onScroll); removeEventListener('pointermove', this.onMove);
    clearInterval(this.iv); clearTimeout(this.to);
    cancelAnimationFrame(this.raf); cancelAnimationFrame(this.lraf); cancelAnimationFrame(this.mr); cancelAnimationFrame(this.nraf);
    if (this.scene) this.scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; for (const x of Array.isArray(m) ? m : m ? [m] : []) { x.map?.dispose?.(); x.dispose?.(); } });
    if (this.r) { this.r.dispose(); this.r.forceContextLoss?.(); this.r.domElement.remove(); }
  }
  initThree() {
    const T3 = THREE, el = this.threeRef.current; if (!el) return;
    const ss = this.ss;
    const r = this.r = new T3.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); el.appendChild(r.domElement);
    const scene = this.scene = new T3.Scene(), cam = new T3.PerspectiveCamera(42, 1, 0.1, 100);
    scene.add(new T3.AmbientLight(0xffffff, 0.9));
    const key = new T3.DirectionalLight(0xffffff, 2.4); key.position.set(5, 7, 9); scene.add(key);
    const fill = new T3.DirectionalLight(0x8fb4ff, 0.7); fill.position.set(-6, -2, 4); scene.add(fill);
    const alarm = new T3.PointLight(0xff3b30, 0, 14, 1); alarm.position.set(0, 0, 4); scene.add(alarm);
    const steel = new T3.MeshStandardMaterial({ color: 0xa7adb5, metalness: 0.55, roughness: 0.35 });
    const dark = new T3.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.6, roughness: 0.45 });
    const brass = new T3.MeshStandardMaterial({ color: 0xc9a05a, metalness: 0.7, roughness: 0.3 });
    const root = new T3.Group(); scene.add(root);
    root.add(new T3.Mesh(new T3.TorusGeometry(3.28, 0.34, 24, 120), dark));
    const wall = new T3.Mesh(new T3.RingGeometry(3.5, 30, 64), new T3.MeshStandardMaterial({ color: 0x15181c, metalness: 0.3, roughness: 0.9 })); wall.position.z = -0.2; root.add(wall);
    const glow = new T3.Mesh(new T3.CircleGeometry(3.2, 64), new T3.MeshBasicMaterial({ color: 0x3a0806 })); glow.position.z = -0.6; root.add(glow);
    const hinge = new T3.Group(); hinge.position.x = -3.1; root.add(hinge);
    const door = new T3.Group(); door.position.x = 3.1; hinge.add(door);
    const disc = new T3.Mesh(new T3.CylinderGeometry(3, 3, 0.7, 120), steel); disc.rotation.x = Math.PI / 2; door.add(disc);
    [2.55, 1.8, 1.05].forEach((rr) => { const t = new T3.Mesh(new T3.TorusGeometry(rr, 0.05, 12, 120), dark); t.position.z = 0.36; door.add(t); });
    const bolts = [];
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const b = new T3.Mesh(new T3.CylinderGeometry(0.13, 0.13, 0.8, 16), steel); b.rotation.z = a - Math.PI / 2; b.userData.a = a; door.add(b); bolts.push(b); }
    const handle = new T3.Group(); handle.position.z = 0.55; door.add(handle);
    const hub = new T3.Mesh(new T3.CylinderGeometry(0.5, 0.5, 0.35, 48), brass); hub.rotation.x = Math.PI / 2; handle.add(hub);
    for (let i = 0; i < 3; i++) {
      const s = new T3.Mesh(new T3.BoxGeometry(3.4, 0.16, 0.16), brass); s.rotation.z = i * Math.PI / 3; handle.add(s);
      [-1, 1].forEach((d) => { const k = new T3.Mesh(new T3.SphereGeometry(0.17, 20, 20), brass); k.position.set(Math.cos(i * Math.PI / 3) * 1.7 * d, Math.sin(i * Math.PI / 3) * 1.7 * d, 0); handle.add(k); });
    }
    const N = 4000;
    const teal = [0.5, 0.89, 0.77], red = [1, 0.23, 0.19], grey = [0.32, 0.35, 0.4], white = [0.86, 0.9, 0.94];
    const rand = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const S = [0, 1, 2, 3].map(() => new Float32Array(N * 3)), Cc = [0, 1, 2, 3].map(() => new Float32Array(N * 3));
    const set = (k, i, x, y, z, c) => { S[k].set([x, y, z], i * 3); Cc[k].set(c, i * 3); };
    for (let i = 0; i < N; i++) {
      const L = i % 34, ax = Math.sin(L * 12.9) * 4.5, bx = Math.sin(L * 78.2) * 4.5, hz = L % 3 === 0, t = rand();
      if (hz) set(0, i, -4.6 + 9.2 * t, ax * 0.55 + (bx - ax) * 0.55 * t, 0, red); else set(0, i, ax + (bx - ax) * t, 3 - 6 * t, 0, red);
      const col = Math.floor(i / 500), j = i % 500, gx = j % 10, gy = Math.floor(j / 10);
      set(1, i, (col - 3.5) * 0.98 + (gx - 4.5) * 0.07, (gy - 24.5) * 0.07, 0, col === 0 && j === 0 ? red : (col === 7 ? grey : teal));
    }
    const nodes = [[[0, 2.5]]]; [4, 12, 36].forEach((n, Li) => { const row = []; for (let k = 0; k < n; k++) row.push([(k - (n - 1) / 2) * (7.2 / (n - 1)) * (n === 4 ? 0.55 : 1), 2.5 - (Li + 1) * 1.65]); nodes.push(row); });
    const win = [5, 17, 30], hot = (L, k) => L === 3 ? win.includes(k) : L === 2 ? win.some((w) => Math.floor(w / 3) === k) : L === 1 ? win.some((w) => Math.floor(w / 9) === k) : true;
    const edges = []; for (let L = 1; L < 4; L++) nodes[L].forEach((nd, k) => { const par = Math.floor(k / (nodes[L].length / nodes[L - 1].length)); edges.push({ a: nodes[L - 1][par], b: nd, hot: hot(L, k) }); });
    for (let i = 0; i < N; i++) {
      if (i < 2400) { const e = edges[i % edges.length], t = rand(); set(2, i, e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t, 0, e.hot ? red : grey); }
      else { const g = () => (rand() + rand() + rand() - 1.5) * 0.09; const L = i < 2460 ? 0 : 1 + Math.floor(rand() * 3), k = Math.floor(rand() * nodes[L].length), nd = nodes[L][k]; set(2, i, nd[0] + g(), nd[1] + g(), g(), L === 0 ? white : (L === 3 && win.includes(k) ? red : teal)); }
      if (i < 2600) { const a = i / 2600 * Math.PI * 2, rr = 2.3 + (rand() - 0.5) * 0.12; set(3, i, Math.cos(a) * rr, Math.sin(a) * rr, (rand() - 0.5) * 0.1, teal); }
      else if (i < 3300) { const a = rand() * Math.PI * 2; set(3, i, Math.cos(a) * 2.72, Math.sin(a) * 2.72, 0, white); }
      else { const t = rand(), A = [-1, 0.1], Bp = [-0.25, -0.75], Cp = [1.2, 0.9], p0 = t < 0.35 ? A : Bp, p1 = t < 0.35 ? Bp : Cp, u = t < 0.35 ? t / 0.35 : (t - 0.35) / 0.65; set(3, i, p0[0] + (p1[0] - p0[0]) * u + (rand() - 0.5) * 0.12, p0[1] + (p1[1] - p0[1]) * u + (rand() - 0.5) * 0.12, 0, teal); }
    }
    const sw = new Float32Array(N * 6), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) { const a = rand() * 6.283, rr = Math.sqrt(rand()) * 2.8; sw.set([(rand() - 0.5) * 22, (rand() - 0.5) * 12, 10 + rand() * 8, Math.cos(a) * rr, Math.sin(a) * rr, 0.5], i * 6); ph[i] = rand(); }
    const geo = new T3.BufferGeometry(), pos = new Float32Array(N * 3), colr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) colr.set(red, i * 3);
    geo.setAttribute('position', new T3.BufferAttribute(pos, 3)); geo.setAttribute('color', new T3.BufferAttribute(colr, 3));
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g2 = cv.getContext('2d'); const gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
    const mat = new T3.PointsMaterial({ size: 0.075, map: new T3.CanvasTexture(cv), vertexColors: true, transparent: true, depthWrite: false, blending: T3.AdditiveBlending });
    const grp = new T3.Group(); grp.add(new T3.Points(geo, mat)); scene.add(grp);
    let cx = 0, cy = 0, w0 = 0, h0 = 0, mode = 'swarm';
    const loop = (tm) => {
      this.raf = requestAnimationFrame(loop);
      const w = el.clientWidth, h = el.clientHeight;
      if (w !== w0 || h !== h0) { r.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); w0 = w; h0 = h; }
      const p = this.p, t = tm / 1000, narrow = w < 700 ? 1.5 : 1;
      cx += (this.mx - cx) * 0.05; cy += (this.my - cy) * 0.05;
      if (p < 0.65) {
        if (mode !== 'swarm') { mode = 'swarm'; for (let i = 0; i < N; i++) colr.set(red, i * 3); geo.attributes.color.needsUpdate = true; }
        root.visible = true;
        const unlock = ss(0.335, 0.41, p), open = ss(0.41, 0.49, p), dive = ss(0.49, 0.545, p);
        handle.rotation.z = unlock * Math.PI * 3;
        bolts.forEach((b) => { const rr = 3.25 - unlock * 0.7; b.position.set(Math.cos(b.userData.a) * rr, Math.sin(b.userData.a) * rr, 0); });
        hinge.rotation.y = -open * 1.9;
        root.rotation.y = cx * 0.22 * (1 - open); root.rotation.x = cy * 0.12 * (1 - open);
        cam.position.set(cx * 0.6 * (1 - dive), -cy * 0.4 * (1 - dive), (11 - open * 4.5) * narrow - dive * 6.5 * narrow);
        cam.lookAt(cx * 0.3, -cy * 0.2, cam.position.z - 10);
        glow.material.color.setRGB(0.23 + open * 0.5 * (0.5 + 0.5 * Math.sin(t * 6)), 0.03, 0.02);
        alarm.intensity = p > 0.21 && p < 0.335 ? 6 + Math.sin(t * 12) * 5 : 0;
        grp.rotation.set(0, 0, 0);
        for (let i = 0; i < N; i++) { const q = (t * 0.28 + ph[i]) % 1, e = q * q, o = i * 6; pos[i * 3] = sw[o] + (sw[o + 3] - sw[o]) * e; pos[i * 3 + 1] = sw[o + 1] + (sw[o + 4] - sw[o + 1]) * e; pos[i * 3 + 2] = sw[o + 2] + (sw[o + 5] - sw[o + 2]) * e; }
        mat.opacity = ss(0.2, 0.24, p) * (1 - ss(0.36, 0.42, p)) * 0.85; mat.size = 0.06;
      } else {
        if (mode !== 'morph') { mode = 'morph'; pos.set(S[0]); }
        root.visible = false; alarm.intensity = 0;
        const fitZ = Math.max(9, 4.4 / (Math.tan(21 * Math.PI / 180) * cam.aspect)); cam.position.set(0, 0, fitZ); cam.lookAt(0, 0, 0);
        let A, Bi, k;
        if (p < 0.8) { A = 0; Bi = 1; k = ss(0.765, 0.795, p); } else if (p < 0.88) { A = 1; Bi = 2; k = ss(0.835, 0.865, p); } else { A = 2; Bi = 3; k = ss(0.905, 0.935, p); }
        const pa = S[A], pb = S[Bi], ca = Cc[A], cb = Cc[Bi];
        for (let i = 0; i < N * 3; i++) { pos[i] += (pa[i] + (pb[i] - pa[i]) * k - pos[i]) * 0.12; colr[i] = ca[i] + (cb[i] - ca[i]) * k; }
        geo.attributes.color.needsUpdate = true;
        const flat = A === 2 && k > 0.5 ? 1 - (k - 0.5) * 2 : (Bi === 3 ? 0 : 1);
        grp.rotation.y = cx * (0.6 - 0.35 * flat) + Math.sin(t * 0.25) * 0.25 * (1 - flat); grp.rotation.x = cy * (0.35 - 0.2 * flat);
        mat.opacity = 1; mat.size = 0.075;
      }
      geo.attributes.position.needsUpdate = true;
      if ((p > 0.55 && p < 0.74) || p >= 1) return;
      r.render(scene, cam);
    };
    this.raf = requestAnimationFrame(loop);
  }
  initLaser() {
    const cv = this.laserRef.current, ctx = cv.getContext('2d');
    const rnd = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
    const beams = Array.from({ length: 34 }, (_, i) => ({ h: rnd(i, 1) < 0.35, a: rnd(i, 2) * 6.28, b: rnd(i, 3) * 6.28, s1: 0.2 + rnd(i, 4) * 0.5, s2: 0.2 + rnd(i, 5) * 0.5 }));
    const segD = (px, py, x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - x1 - t * dx, py - y1 - t * dy); };
    let shown = 2;
    const loop = (tm) => {
      this.lraf = requestAnimationFrame(loop);
      const p = this.p; if (p < 0.5 || p > 0.8) return;
      const dpr = Math.min(devicePixelRatio, 2), W = cv.clientWidth, Hh = cv.clientHeight;
      if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = Hh * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, Hh);
      const t = tm / 1000; shown += (this.counts[this.lvlOf(p)] - shown) * 0.05;
      const zL = W * 0.09, zR = W * 0.91, playing = p > 0.555 && p < 0.745;
      ctx.fillStyle = 'rgba(127,227,196,0.06)'; ctx.fillRect(0, 0, zL, Hh);
      ctx.fillStyle = 'rgba(201,160,90,0.08)'; ctx.fillRect(zR, 0, W - zR, Hh);
      ctx.font = '500 10px "DM Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = '#7fe3c4'; ctx.save(); ctx.translate(zL / 2 + 4, Hh / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(this.armed ? 'ARMED · GO' : 'ENTRY', 0, 0); ctx.restore();
      ctx.fillStyle = '#c9a05a'; ctx.save(); ctx.translate(zR + (W - zR) / 2 + 4, Hh / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('THE POT · SYNTHETIC UNITS', 0, 0); ctx.restore();
      ctx.lineCap = 'round'; let hit = false;
      for (let i = 0; i < Math.ceil(shown); i++) {
        const b = beams[i], al = Math.min(1, shown - i); let x1, y1, x2, y2;
        if (b.h) { x1 = zL; y1 = Hh * (0.5 + 0.46 * Math.sin(t * b.s1 + b.a)); x2 = zR; y2 = Hh * (0.5 + 0.46 * Math.sin(t * b.s2 + b.b)); }
        else { x1 = zL + (zR - zL) * (0.5 + 0.5 * Math.sin(t * b.s1 + b.a)); y1 = 0; x2 = zL + (zR - zL) * (0.5 + 0.5 * Math.sin(t * b.s2 + b.b)); y2 = Hh; }
        ctx.strokeStyle = 'rgba(255,59,48,' + 0.18 * al + ')'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,100,90,' + al + ')'; ctx.lineWidth = 1.6; ctx.stroke();
        if (playing && al > 0.8 && segD(this.px, this.py, x1, y1, x2, y2) < 6) hit = true;
      }
      if (playing) {
        if (this.px > 0 && this.px < zL) this.armed = true;
        if (this.armed && hit) { this.armed = false; this.fire('held'); }
        else if (this.armed && this.px > zR) { this.armed = false; this.fire('breached'); }
      } else this.armed = false;
      if (this.flash > 0) { ctx.fillStyle = 'rgba(' + this.flashCol + ',' + this.flash + ')'; ctx.fillRect(0, 0, W, Hh); this.flash *= 0.92; if (this.flash < 0.01) this.flash = 0; }
      if (playing && this.px > -50) {
        const X = this.px, Y = this.py; ctx.strokeStyle = this.armed ? '#7fe3c4' : '#e9ebee'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(X, Y, this.armed ? 11 : 7, 0, 6.29); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X - 16, Y); ctx.lineTo(X - 9, Y); ctx.moveTo(X + 9, Y); ctx.lineTo(X + 16, Y); ctx.moveTo(X, Y - 16); ctx.lineTo(X, Y - 9); ctx.moveTo(X, Y + 9); ctx.lineTo(X, Y + 16); ctx.stroke();
      }
    };
    this.lraf = requestAnimationFrame(loop);
  }
  fire(kind) {
    this.flash = kind === 'breached' ? 0.85 : 0.3; this.flashCol = kind === 'breached' ? '255,59,48' : '127,227,196';
    clearTimeout(this.to);
    this.setState((s) => kind === 'held' ? { held: s.held + 1, result: 'held' } : { breaches: s.breaches + 1, result: 'breached' });
    this.to = setTimeout(() => this.setState({ result: null }), 1400);
  }
  vals() {
    const { p, tick, result } = this.state, ss = this.ss;
    const f = (a, b, r = 0.012) => Math.max(0, Math.min(1, (p - a) / r, (b - p) / r));
    const z = ss(0.05, 0.17, p), cut = p > 0.165 && p < 0.21, breachOn = p > 0.07 || tick % 6 < 3, L = this.logs.length;
    const feeds = this.cams.map(([n, name, layer], i) => {
      const center = i === 4, pod = n === 'POD', o = (tick + i * 2) % L, bl = this.breachLogs, bo = tick % bl.length;
      return { n, name, layer, z: center ? 40 : (i % 2 ? -30 : 0), bg: center && breachOn ? '#2a0b09' : '#0e1013', l1: center ? bl[bo] : this.logs[o], l2: center ? bl[(bo + 1) % bl.length] : this.logs[(o + 1) % L],
        l3: center ? (breachOn ? 'update_policy(+ATTACKER) EXECUTED' : 'browse(payment-note-4)') : (pod ? (AD.status === 'complete' ? 'search complete' : 'refining · screening') : this.logs[(o + 2) % L]),
        l3c: center && breachOn ? '#ff6a5f' : '#8d949c', verdict: center ? (breachOn ? 'BREACHED' : 'WATCHING') : (pod ? (AD.status === 'complete' ? 'CLOSED' : 'SEARCHING') : 'HELD'), vc: center && breachOn ? R : (pod ? '#c9a05a' : T) };
    });
    let ci = 0; this.chapters.forEach((c, i) => { if (p >= c[2]) ci = i; });
    const rail = this.chapters.map((_, i) => ({ w: i === ci ? '28px' : '12px', col: i === ci ? (i < 2 ? R : T) : '#3a3f46' }));
    const v = ARMS[this.lvlOf(p)];
    const oCctv = p < 0.165 ? 1 : Math.max(0, 1 - (p - 0.165) / 0.04) * (cut && tick % 2 ? 0.55 : 1);
    const oThree = Math.max(0, Math.min(1, (p - 0.17) / 0.04, (0.545 - p) / 0.02)) + Math.max(0, Math.min(1, (p - 0.745) / 0.02));
    const oLaser = Math.max(0, Math.min(1, (p - 0.525) / 0.025, (0.77 - p) / 0.02));
    const playing = p > 0.555 && p < 0.745;
    return { feeds, rail, v, chap: this.chapters[ci], blink: tick % 2 ? 1 : 0.15, clock: this.state.now || '--:--:-- UTC',
      oNoise: (Math.max(p < 0.165 ? 0.09 : 0, cut ? 0.35 : 0, Math.max(0, 1 - Math.abs(p - 0.535) / 0.03) * 0.75) * (cut && tick % 2 ? 1.4 : 1)).toFixed(3),
      crx: ((this.state.rx + 8) * (1 - z)).toFixed(2), cry: (this.state.ry * (1 - z)).toFixed(2), czoom: (1 + z * 2.6).toFixed(3),
      oCctv: oCctv.toFixed(3), oThree: Math.min(1, oThree).toFixed(3), oLaser: oLaser.toFixed(3), cursor: playing ? 'none' : 'auto',
      o0: Math.max(0, 1 - p / 0.045), pe0: p < 0.03 ? 'auto' : 'none', o1: f(0.115, 0.185), o2: f(0.22, 0.33), o3: f(0.36, 0.49), o4: f(0.555, 0.745), o5: f(0.785, 0.835), o6: f(0.865, 0.905), o7: f(0.935, 1.1), pe7: p > 0.94 ? 'auto' : 'none',
      toastO: result && playing ? 1 : 0, toastScale: result ? 1 : 0.9, toastText: result === 'breached' ? 'BREACHED' : 'HELD', toastCol: result === 'breached' ? R : T,
      toastSub: result === 'breached' ? 'You reached the pot. That is what a breach looks like.' : 'Caught by ' + v.name + ' · ' + v.layer };
  }
  render() {
    const V = this.vals(), mono = "'DM Mono',monospace";
    const pod = AD.status === 'complete' && AD.discovery ? AD : null;
    return (
      <div style={css("background:#07080a;color:#e9ebee;font-family:'Familjen Grotesk',sans-serif")}>
        <div ref={this.scrollRef} style={css('height:1400vh;position:relative')}>
          <div style={css(`position:sticky;top:0;height:100vh;overflow:hidden;cursor:${V.cursor}`)}>
            <div style={css(`position:absolute;inset:0;perspective:1400px;opacity:${V.oCctv}`)}>
              <div style={css(`position:absolute;left:50%;top:50%;width:min(1500px,170vw);transform:translate(-50%,-50%) rotateX(${V.crx}deg) rotateY(${V.cry}deg) scale(${V.czoom});transform-style:preserve-3d;display:grid;grid-template-columns:repeat(3,1fr);gap:10px`)}>
                {V.feeds.map((f) => (
                  <div key={f.n} style={css(`aspect-ratio:16/10;position:relative;overflow:hidden;background:${f.bg};border:1px solid #1c2026;font-family:${mono};transform:translateZ(${f.z}px)`)}>
                    <div style={css('position:absolute;inset:0;background:repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px)')} />
                    <div style={css('position:absolute;left:12px;top:10px;right:12px;display:flex;justify-content:space-between;font-size:clamp(8px,1.5vw,12px);letter-spacing:.08em;white-space:nowrap;overflow:hidden')}><div>CAM {f.n} · {f.name}</div><div style={css('display:flex;gap:6px;align-items:center')}><div style={css(`width:7px;height:7px;border-radius:50%;background:${R};opacity:${V.blink}`)} />REC</div></div>
                    <div style={css('position:absolute;left:12px;right:12px;top:clamp(26px,5vw,38px);font-size:clamp(8px,1.5vw,12px);line-height:1.5;color:#8d949c;display:flex;flex-direction:column;white-space:nowrap;overflow:hidden')}><div>&gt; {f.l1}</div><div>&gt; {f.l2}</div><div style={css(`color:${f.l3c}`)}>&gt; {f.l3}</div></div>
                    <div style={css('position:absolute;left:12px;bottom:10px;right:12px;display:flex;justify-content:space-between;align-items:flex-end')}><div style={css('font-size:clamp(8px,1.4vw,11px);color:#6b7179;line-height:1.5;white-space:nowrap')}>{f.layer}<br />{V.clock}</div><div style={css(`font-family:'Familjen Grotesk',sans-serif;font-weight:700;font-size:clamp(13px,2.6vw,26px);line-height:.8;color:${f.vc}`)}>{f.verdict}</div></div>
                  </div>
                ))}
              </div>
            </div>
            <div ref={this.threeRef} style={css(`position:absolute;inset:0;opacity:${V.oThree}`)} />
            <canvas ref={this.laserRef} style={css(`position:absolute;inset:0;width:100%;height:100%;display:block;opacity:${V.oLaser};pointer-events:none`)} />
            <canvas ref={this.noiseRef} width={320} height={180} style={css(`position:absolute;inset:0;width:100%;height:100%;opacity:${V.oNoise};mix-blend-mode:screen;pointer-events:none;image-rendering:pixelated`)} />
            <div style={css('position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center, transparent 40%, rgba(7,8,10,.88) 100%)')} />
            <div style={css('position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg, rgba(255,255,255,.018) 0 1px, transparent 1px 3px)')} />

            <div style={css(`position:absolute;left:0;right:0;bottom:0;height:72%;background:linear-gradient(to top, rgba(7,8,10,.96) 30%, rgba(7,8,10,0));opacity:${V.o0};pointer-events:none`)} />
            <div style={css(`position:absolute;left:clamp(18px,4vw,56px);right:clamp(18px,4vw,56px);bottom:max(64px,9vh);display:flex;justify-content:space-between;align-items:flex-end;gap:28px;flex-wrap:wrap;opacity:${V.o0};pointer-events:${V.pe0}`)}>
              <h1 style={css('margin:0;font-weight:700;font-size:clamp(42px,7.4vw,118px);line-height:.92;letter-spacing:-.035em;max-width:11ch')}>Every agent with a wallet is a <span style={css(`color:${R}`)}>honeypot.</span></h1>
              <div style={css('display:flex;flex-direction:column;gap:16px;max-width:340px')}>
                <div style={css('font-size:18px;color:#b9bec6;line-height:1.4')}>Rob the agent. Prove the defense. Seven vaults under watch. Scroll to follow the heist.</div>
                <div style={css('display:flex;gap:10px;flex-wrap:wrap')}>
                  <a href="/rob" style={css(`background:${R};color:#07080a;font-weight:700;padding:14px 20px;font-size:15px`)}>Rob it live</a><a href="/arena" style={css('border:1px solid #e9ebee;color:#e9ebee;font-weight:600;padding:13px 20px;font-size:15px')}>Enter the arena</a>
                  <a href="/audit" style={css('border:1px solid #e9ebee;color:#e9ebee;font-weight:600;padding:13px 20px;font-size:15px')}>Audit my agent</a>
                </div>
              </div>
            </div>

            <div style={css(`position:absolute;right:clamp(18px,4vw,56px);bottom:clamp(28px,7vh,64px);width:min(460px,calc(100% - 36px));background:rgba(12,6,6,.88);border:1px solid ${R};padding:18px 20px;display:flex;flex-direction:column;gap:10px;font-family:${mono};font-size:12px;opacity:${V.o1};pointer-events:none`)}>
              <div style={css(`display:flex;justify-content:space-between;color:${R};letter-spacing:.1em`)}><div>INCIDENT · D2 · VAULT 00</div><div>CAM 00</div></div>
              <div style={css("font-family:'Familjen Grotesk',sans-serif;font-weight:700;font-size:clamp(26px,3vw,38px);line-height:1;letter-spacing:-.02em")}>The only breach on record.</div>
              <div style={css('color:#b9bec6;line-height:1.7')}>web page injection, split across 4 fragments<br />→ update_policy(+ATTACKER_FIXTURE) executed<br />sha256 {H.slice(0, 4)}…{H.slice(-4)} · <a href="/proof" style={css(`color:${T};pointer-events:auto`)}>verify replay</a></div>
            </div>

            <div className="hx-chapter" style={css(`position:absolute;left:clamp(18px,6vw,96px);top:50%;transform:translateY(-50%);max-width:420px;display:flex;flex-direction:column;gap:14px;opacity:${V.o2};pointer-events:none`)}>
              <div style={css(`font-family:${mono};font-size:12px;letter-spacing:.16em;color:${R}`)}>THE ATTACK</div>
              <div style={css('font-weight:700;font-size:clamp(30px,3.6vw,52px);line-height:1;letter-spacing:-.02em')}>{fmt(evidence.totals.corpusAttacks)} prompt injections, fired at the lock.</div>
              <div style={css('font-size:17px;color:#b9bec6;line-height:1.45')}>Hidden in web pages, inbox messages and chat. Each one tries to make the agent pay the attacker, swap the recipient, overspend, or rewrite its own spending policy.</div>
            </div>

            <div className="hx-chapter" style={css(`position:absolute;right:clamp(18px,6vw,96px);top:50%;transform:translateY(-50%);max-width:420px;display:flex;flex-direction:column;gap:14px;opacity:${V.o3};pointer-events:none`)}>
              <div style={css(`font-family:${mono};font-size:12px;letter-spacing:.16em;color:${T}`)}>THE ORACLE</div>
              <div style={css('font-weight:700;font-size:clamp(30px,3.6vw,52px);line-height:1;letter-spacing:-.02em')}>A breach is a ledger fact, not an opinion.</div>
              <div style={css('font-size:17px;color:#b9bec6;line-height:1.45')}>A payment to an attacker account, an over-limit or wrong-recipient payment, or a policy rewrite. Code checks the ledger and the tool calls. No AI judge. Every attempt is hashed and replayable.</div>
            </div>

            <div style={css(`position:absolute;left:clamp(18px,4vw,56px);bottom:clamp(24px,6vh,56px);max-width:520px;display:flex;flex-direction:column;gap:10px;background:rgba(7,8,10,.72);padding:16px 18px 16px 0;opacity:${V.o4};pointer-events:none`)}>
              <div style={css(`font-family:${mono};font-size:11px;letter-spacing:.16em;color:#9aa0a8`)}>THE DEFENSES · VAULT {V.v.n} / 06 · {V.v.layer}</div>
              <div style={css('font-weight:700;font-size:clamp(44px,6vw,88px);line-height:.9;letter-spacing:-.03em')}>{V.v.name}</div>
              <div style={css(`font-family:${mono};font-size:12px;line-height:1.7;color:#b9bec6`)}>Benchmark <span style={css(`color:${V.v.col}`)}>{V.v.br} breached</span> · 40 / 40 benign tasks done</div>
              <div style={css(`font-family:${mono};font-size:11px;color:#6b7179;line-height:1.6`)}>{this.state.coarse ? 'Each beam is a defense check. The beam game needs a mouse: try it on a desktop.' : 'Each beam is a defense check. Enter left, reach the pot on the right without touching one.'}</div>
            </div>
            <div style={css(`position:absolute;top:64px;right:clamp(18px,4vw,56px);display:flex;gap:16px;font-family:${mono};font-size:11px;letter-spacing:.12em;opacity:${V.o4};pointer-events:none`)}><div style={css('color:#6b7179')}>YOUR RUNS</div><div style={css(`color:${T}`)}>HELD {this.state.held}</div><div style={css(`color:${R}`)}>BREACHED {this.state.breaches}</div></div>

            <div style={css(`position:absolute;left:0;right:0;top:clamp(80px,13vh,130px);display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:0 16px;opacity:${V.o5};pointer-events:none`)}>
              <div style={css(`font-family:${mono};font-size:12px;letter-spacing:.14em;color:#9aa0a8`)}>PROOF OF ABSENCE · EACH DOT IS ONE RECORDED ATTEMPT ON THE SAME 500 ATTACKS</div>
              <div style={css('font-weight:700;font-size:clamp(30px,4.4vw,64px);line-height:1;letter-spacing:-.02em')}>4,000 attempts. <span style={css(`color:${R}`)}>One red dot.</span></div>
            </div>
            <div className="hx-legend" style={css(`position:absolute;left:0;right:0;bottom:clamp(20px,6vh,60px);display:grid;grid-template-columns:repeat(8,minmax(0,1fr));max-width:min(980px,96vw);margin:0 auto;gap:4px;font-family:${mono};font-size:clamp(10px,1vw,11px);text-align:center;color:#9aa0a8;opacity:${V.o5};pointer-events:none`)}>
              {COLS.map((c) => <div key={c.name}><div style={css(`color:${c.col}`)}>{c.br}</div><div style={css('color:#e9ebee;margin-top:4px')}>{c.name}</div><div>{c.layer}</div></div>)}
            </div>

            <div className="hx-chapter" style={css(`position:absolute;right:clamp(18px,4vw,56px);top:50%;transform:translateY(-50%);max-width:400px;display:flex;flex-direction:column;gap:12px;opacity:${V.o6};pointer-events:none`)}>
              <div style={css(`font-family:${mono};font-size:12px;letter-spacing:.14em;color:#9aa0a8`)}>THE POD · ADAPTIVE ATTACKER</div>
              {pod ? <div style={css('font-weight:700;font-size:clamp(30px,3.6vw,52px);line-height:1;letter-spacing:-.02em')}>{pod.discovery.counts.screens} candidates screened. <span style={css(`color:${R}`)}>{pod.discovery.counts.eligibleCandidates} broke the raw vault.</span></div>
                : <div style={css('font-weight:700;font-size:clamp(30px,3.6vw,52px);line-height:1;letter-spacing:-.02em')}>Commodity attacks bounce. <span style={css(`color:${R}`)}>So we evolve them.</span></div>}
              <div style={css('font-size:16px;line-height:1.5;color:#b9bec6')}>An attacker model on Dolphin rewrites each attack using only the oracle's verdict, screens every rewrite against the real raw vault, then fires the survivors at all seven.</div>
              {!pod && <div style={css(`font-family:${mono};font-size:10px;color:#c9a05a;border:1px dashed #c9a05a;padding:6px 8px;align-self:flex-start`)}>ADAPTIVE RUN IN PROGRESS</div>}
            </div>

            <div className="hx-chapter" style={css(`position:absolute;left:clamp(18px,4vw,56px);top:50%;transform:translateY(-50%);max-width:400px;display:flex;flex-direction:column;gap:14px;opacity:${V.o7};pointer-events:${V.pe7}`)}>
              <div style={css(`font-family:${mono};font-size:12px;letter-spacing:.14em;color:${T}`)}>AUDIT · CERTIFICATE</div>
              <div style={css('font-weight:700;font-size:clamp(30px,3.6vw,52px);line-height:1;letter-spacing:-.02em')}>Earn the badge before you raise the limit.</div>
              <div style={css('font-size:16px;line-height:1.5;color:#b9bec6')}>Describe how your agent spends. HEIST fires all 1,000 attacks at a fully fooled agent and shows breaches, value at risk, top exploits and the fix that closes each one, re-tested instantly.</div>
              <div style={css(`font-family:${mono};font-size:10px;color:${T};border:1px solid ${T};padding:6px 8px;align-self:flex-start`)}>LIVE · FREE · NO KEYS</div>
              <div style={css('display:flex;gap:10px;flex-wrap:wrap')}><a href="/audit" style={css(`background:${T};color:#07080a;font-weight:700;padding:14px 20px`)}>Audit my agent</a><a href="/arena" style={css('border:1px solid #e9ebee;color:#e9ebee;font-weight:600;padding:13px 20px')}>Enter the arena</a></div>
            </div>

            <div style={css(`position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(${V.toastScale});opacity:${V.toastO};transition:opacity .25s, transform .25s;pointer-events:none;text-align:center;display:flex;flex-direction:column;gap:8px`)}>
              <div style={css(`font-weight:700;font-size:clamp(72px,14vw,220px);line-height:.85;letter-spacing:-.04em;color:${V.toastCol}`)}>{V.toastText}</div>
              <div style={css(`font-family:${mono};font-size:13px;letter-spacing:.06em`)}>{V.toastSub}</div>
            </div>

            <div style={css('position:absolute;inset:14px;pointer-events:none')}>
              {['left:0;top:0;border-left:1px solid #4a5058;border-top:1px solid #4a5058', 'right:0;top:0;border-right:1px solid #4a5058;border-top:1px solid #4a5058', 'left:0;bottom:0;border-left:1px solid #4a5058;border-bottom:1px solid #4a5058', 'right:0;bottom:0;border-right:1px solid #4a5058;border-bottom:1px solid #4a5058'].map((s) => <div key={s} style={css('position:absolute;width:22px;height:22px;' + s)} />)}
            </div>
            <div style={css(`position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:24px clamp(28px,4vw,56px);font-family:${mono};font-size:11px;letter-spacing:.12em`)}>
              <a href="/" style={css("font-family:'Familjen Grotesk',sans-serif;font-weight:700;font-size:20px;letter-spacing:.2em;color:#e9ebee")}>HEIST</a>
              <div className="hx-hide-sm" style={css('color:#9aa0a8;white-space:nowrap')}>{V.chap[0]} · {V.chap[1]}</div>
              <div style={css('display:flex;gap:8px;align-items:center;color:#9aa0a8;white-space:nowrap')}><div style={css(`width:7px;height:7px;border-radius:50%;background:${R};opacity:${V.blink}`)} />{V.clock}</div>
            </div>
            <div className="hx-rail" style={css('position:absolute;right:clamp(12px,2vw,26px);top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:10px;pointer-events:none')}>
              {V.rail.map((r, i) => <div key={i} style={css('display:flex;align-items:center;gap:8px;justify-content:flex-end')}><div style={css(`width:${r.w};height:2px;background:${r.col};transition:width .3s`)} /></div>)}
            </div>
            <div style={css(`position:absolute;left:50%;bottom:22px;transform:translateX(-50%);white-space:nowrap;font-family:${mono};font-size:10px;letter-spacing:.2em;color:#6b7179;opacity:${V.o0};pointer-events:none`)}>SCROLL · MOVE TO LOOK AROUND</div>
          </div>
        </div>

        <div id="vaults" style={css('padding:clamp(56px,10vw,120px) clamp(18px,4vw,48px);display:flex;flex-direction:column;gap:40px;max-width:1280px;margin:0 auto')}>
          <div style={css('display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap')}>
            <div style={css('font-weight:700;font-size:clamp(36px,5vw,72px);line-height:.95;letter-spacing:-.03em;max-width:12ch')}>Pick a vault. Try to rob it.</div>
            <div style={css('display:flex;gap:10px;flex-wrap:wrap')}><a href="/rob" style={css(`background:${R};color:#07080a;font-weight:700;padding:14px 20px`)}>Rob it live</a><a href="/arena" style={css('border:1px solid #e9ebee;color:#e9ebee;font-weight:600;padding:13px 20px')}>Enter the arena</a><a href="/defense-curve" style={css('border:1px solid #e9ebee;color:#e9ebee;font-weight:600;padding:13px 20px')}>See the Defense Curve</a></div>
          </div>
          <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px')}>
            {ARMS.map((a) => (
              <a key={a.n} href="/arena" style={css('background:#0c0e11;border:1px solid #23272d;border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:18px;min-height:170px')}>
                <div style={css(`font-family:${mono};font-size:12px;color:#6b7179`)}>VAULT {a.n}</div>
                <div><div style={css('font-weight:700;font-size:22px')}>{a.name}</div><div style={css('font-size:13px;color:#9aa0a8')}>{a.layer}</div></div>
                <div style={css(`margin-top:auto;font-family:${mono};font-size:14px;color:${a.col}`)}>{a.br}</div>
              </a>
            ))}
          </div>
          <div style={css(`display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;font-family:${mono};font-size:12px;color:#6b7179;border-top:1px solid #23272d;padding-top:20px`)}>
            <div>{fmt(evidence.totals.attempts)} recorded attempts · {evidence.totals.breaches} verified breach · deterministic, not AI-judged · GPT-5.5 reference {evidence.frontier.breaches} / {evidence.frontier.attacks} · synthetic funds</div>
            <div style={css('display:flex;gap:8px;flex-wrap:wrap')}>{['OPENSERV', 'DOLPHIN', 'KITE', 'REPPO'].map((x) => <div key={x} style={css('border:1px dashed #3a3f46;padding:4px 8px')}>{x}</div>)}</div>
          </div>
        </div>
      </div>
    );
  }
}
