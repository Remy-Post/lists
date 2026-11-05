// gl.js: "Today, struck through", a raking light over procedural paper (lazy chunk, raw WebGL2).
//
// The canvas draws only highlight/shadow modulation, as premultiplied alpha, over the real DOM paper.
// The paper relief (fibres, tooth, cockle) is an analytic height field, so its normals cost no
// extra taps. It is lit by a directional light at 10 deg elevation.
// sweep(): the light rakes in from the left over 900 ms (Material emphasized-decelerate), then rests
// as a soft, dim pool that leans toward the pointer through a critically damped spring.
// Idle for 4 s means the rAF loop stops (0% CPU). It also pauses when hidden or off-screen, and
// survives context loss.
//
// The caller provides an isolated, positioned host (e.g. `position:relative; isolation:isolate`).
// The canvas sits at z-index -1 inside it, behind the strikes and the type.

const VS = `#version 300 es
void main(){gl_Position=vec4(vec2(gl_VertexID&1,gl_VertexID>>1)*4.-1.,0,1);}`;

// Uniforms: R buffer size (px); K CSS px per buffer px; C pool centre.xy, along/across radii (CSS px);
// D light travel dir.xy, gain; H highlight rgb; S shadow rgb; T highlight, shadow alpha.
const FS = `#version 300 es
precision highp float;
uniform vec2 R,T;uniform float K;uniform vec4 C;uniform vec3 D,H,S;out vec4 o;
float h(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec3 n(vec2 p){vec2 i=floor(p),f=p-i,u=f*f*f*(f*(f*6.-15.)+10.),w=30.*f*f*(f*(f-2.)+1.);
float a=h(i),b=h(i+vec2(1,0)),c=h(i+vec2(0,1)),k=a-b-c+h(i+1.);
return vec3(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y,w*vec2(b-a+k*u.y,c-a+k*u.x))*2.-vec3(1,0,0);}
vec2 g(vec2 x,float a,vec2 s,float m,float r){mat2 M=mat2(cos(a),sin(a),-sin(a),cos(a));
vec3 v=n(s*(M*x)+a*17.);vec2 d=s*v.yz*M;
if(r>0.){float q=1.-abs(v.x);return m*4.*q*q*q*-sign(v.x)*d;}return m*d;}
void main(){
vec2 x=vec2(gl_FragCoord.x,R.y-gl_FragCoord.y)*K,d=x-C.xy;
float al=dot(d,D.xy),ac=dot(d,vec2(-D.y,D.x)),m=D.z*exp(-al*al/(C.z*C.z)-ac*ac/(C.w*C.w));
if(m<.004){o=vec4(0);return;}
vec2 s=g(x,.4,vec2(1./420.,1./170.),3.,0.)+g(x,2.,vec2(1./150.,1./90.),.8,0.)+g(x,.9,vec2(1./3.),.035,0.)
+g(x,.3,vec2(1./28.,1./2.4),.05,1.)+g(x,1.1,vec2(1./22.,1./2.2),.045,1.)+g(x,1.9,vec2(1./34.,1./2.6),.05,1.)+g(x,2.6,vec2(1./25.,1./2.3),.045,1.);
vec3 N=normalize(vec3(-s,1)),L=vec3(-D.xy*.9848,.1736);
float v=clamp(max(dot(N,L),0.)/.1736-1.,-1.,1.4)*m,a=v>0.?v*T.x:-v*T.y;
a+=(h(gl_FragCoord.xy)-.5)/255.;a=max(a,0.);
o=vec4((v>0.?H:S)*a,a);}`;

const DUR = 900, IDLE = 4000, OMEGA = 7, REST_GAIN = 0.6, FOLLOW = 0.5;
const PAPER = { light: [0.973, 0.98, 0.992], dark: [0.122, 0.137, 0.161] };

// cubic-bezier(x1,y1,x2,y2) by bisection
const bez = (a, b, c, d) => (x) => {
  let lo = 0, hi = 1, t, u;
  for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; u = 1 - t; 3 * u * u * t * a + 3 * u * t * t * c + t * t * t < x ? (lo = t) : (hi = t); }
  return 3 * u * u * t * b + 3 * u * t * t * d + t * t * t;
};
const ease = bez(0.05, 0.7, 0.1, 1); // Material emphasized-decelerate
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => (x = Math.min(Math.max((x - a) / (b - a), 0), 1), x * x * (3 - 2 * x));

let battOK = true, battP, gl2;
const battery = () => (battP ||= (async () => {
  try {
    const b = await navigator.getBattery?.();
    if (b) { const f = () => (battOK = !(b.level < 0.2 && !b.charging)); f(); b.onlevelchange = b.onchargingchange = f; }
  } catch {}
})());

/** WebGL2 (hardware) && !reduced-motion && !Save-Data && battery ok. The battery part is cached. */
export function supported() {
  battery();
  if (gl2 === undefined) {
    try {
      const c = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
      gl2 = !!c; c?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { gl2 = false; }
  }
  return gl2 && !matchMedia('(prefers-reduced-motion: reduce)').matches && !navigator.connection?.saveData && battOK;
}
export async function supportedAsync() { await battery(); return supported(); }

export function strikeLight(host, opts = {}) {
  const cv = document.createElement('canvas'), ac = new AbortController(), on = { signal: ac.signal, passive: true };
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:block';
  host.prepend(cv);

  let gl, U, raf = 0, last = 0, W = 1, H = 1, K = 1, lost = 0, seen = 1, dirty = 1, key = '';
  let phase = 0, t = 0, done, idleAt = 0, tone;
  let sx = 0, sy = 0, vx = 0, vy = 0, px = null, py = 0; // spring state, pointer (CSS px in host)

  const rest = () => [lerp(0.58 * W, px ?? 0.58 * W, FOLLOW), lerp(0.4 * H, px == null ? 0.4 * H : py, FOLLOW)];

  function theme() {
    let p, v = getComputedStyle(host).getPropertyValue('--paper').trim();
    if (v) {
      const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      c.fillStyle = '#7f7f7f'; c.fillStyle = v; c.fillRect(0, 0, 1, 1);
      p = [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((x) => x / 255);
    }
    const dark = opts.theme ? opts.theme === 'dark' : p ? p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722 < 0.5 : matchMedia('(prefers-color-scheme: dark)').matches;
    p ||= PAPER[dark ? 'dark' : 'light'];
    // Highlight: a cool lift of the paper. Shadow: graphite pulled from the paper itself.
    tone = dark
      ? [p.map((x, i) => lerp(x, [0.85, 0.89, 0.96][i], 0.85)), p.map((x) => x * 0.25), [0.06, 0.26]]
      : [[1, 1, 1], p.map((x) => x * 0.3), [0.9, 0.05]];
    dirty = 1;
  }

  function init() {
    gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return;
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) { console.warn('gl.js', gl.getProgramInfoLog(p)); gl = null; return; }
    gl.useProgram(p);
    U = {};
    for (const u of 'RTKCDHS') U[u] = gl.getUniformLocation(p, u);
    dirty = 1;
  }

  function size() {
    const r = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    const bw = Math.max(1, Math.round(w * r)), bh = Math.max(1, Math.round(h * r));
    if (bw !== cv.width || bh !== cv.height) { cv.width = bw; cv.height = bh; }
    W = w || 1; H = h || 1; K = W / bw; dirty = 1;
  }

  const stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
  const kick = () => { if (!raf && phase && gl && !lost && seen && !document.hidden) raf = requestAnimationFrame(frame); };

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(now - last, 250) : 0;
    last = now;

    // Critically damped spring toward the rest target. The closed form is frame-rate independent.
    const [tx, ty] = rest(), s = dt / 1000, ex = Math.exp(-OMEGA * s);
    let e0 = sx - tx, c = vx + OMEGA * e0;
    sx = tx + (e0 + c * s) * ex; vx = (vx - OMEGA * c * s) * ex;
    e0 = sy - ty; c = vy + OMEGA * e0;
    sy = ty + (e0 + c * s) * ex; vy = (vy - OMEGA * c * s) * ex;
    const settled = Math.abs(sx - tx) + Math.abs(sy - ty) < 0.1 && Math.abs(vx) + Math.abs(vy) < 0.1;

    let p = 1;
    if (phase === 1) {
      t += dt; p = Math.min(t / DUR, 1);
      if (p >= 1) { phase = 2; idleAt = now; done?.(); done = null; }
    }
    const e = ease(p), m = smooth(0.1, 0.95, p); // m: band to pool, on linear time so it outlasts the travel
    const R0 = 0.44 * Math.min(W, H) + 0.08 * Math.max(W, H), ang = lerp(0.1, 0.55, e);
    const u = [
      lerp(-0.35 * W, sx, e), lerp(0.62 * H, sy, e),
      lerp(0.17 * W, R0, m), lerp(1.2 * Math.hypot(W, H), R0, m),
      Math.cos(ang), Math.sin(ang), lerp(1, REST_GAIN, smooth(0.3, 1, p)),
    ];
    const k = u.map((x) => x.toFixed(2)).join();
    if (dirty || k !== key) {
      key = k; dirty = 0;
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(U.R, cv.width, cv.height);
      gl.uniform1f(U.K, K);
      gl.uniform4f(U.C, u[0], u[1], u[2], u[3]);
      gl.uniform3f(U.D, u[4], u[5], u[6]);
      gl.uniform3fv(U.H, tone[0]); gl.uniform3fv(U.S, tone[1]); gl.uniform2fv(U.T, tone[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (phase === 2 && settled && now - idleAt > IDLE) return (last = 0);
    raf = requestAnimationFrame(frame);
  }

  const ro = new ResizeObserver(() => { size(); kick(); });
  const io = new IntersectionObserver(([en]) => { seen = en.isIntersecting; seen ? kick() : stop(); });
  ro.observe(host); io.observe(host);
  addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    px = e.clientX - r.left; py = e.clientY - r.top;
    idleAt = performance.now(); kick();
  }, on);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : kick()), on);
  cv.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); lost = 1; stop();
    if (phase === 1) { phase = 2; done?.(); done = null; }
  }, { signal: ac.signal });
  cv.addEventListener('webglcontextrestored', () => { lost = 0; init(); kick(); }, on);

  theme(); size(); init();

  return {
    sweep() {
      done?.();
      theme();
      [sx, sy] = rest(); vx = vy = 0;
      phase = 1; t = 0;
      return new Promise((r) => {
        done = r;
        if (!gl || lost) { phase = 2; done = null; r(); } else kick();
      });
    },
    destroy() {
      stop(); ac.abort(); ro.disconnect(); io.disconnect();
      done?.(); done = null; phase = 0;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      cv.remove(); gl = null;
    },
  };
}
