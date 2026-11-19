// Restored original SkyArchipelago 3D WebGL engine
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/+esm";
const EVT = "skyarch"
const DEFAULTS = {
    islands: [
        {
            key: "abou",
            label: "Studio",
            title: "About Animals",
            x: -58,
            z: -12,
            r: 15,
            kind: "studio",
            dock: -0.6,
        },
        {
            key: "journal",
            label: "Library",
            title: "Journal",
            x: -24,
            z: -78,
            r: 12,
            kind: "library",
            dock: 1.9,
        },
        {
            key: "contact",
            label: "Signal",
            title: "Contact",
            x: 34,
            z: -100,
            r: 11,
            kind: "beacon",
            dock: 1.6,
        },
        {
            key: "work",
            label: "Sanctuary",
            title: "Animals",
            x: 66,
            z: -22,
            r: 16,
            kind: "gallery",
            dock: 3.6,
        },
    ],
    images: [],
    envelope: "#2B3BFF",
    timeOfDay: "day",
    controls: true,
    labels: true,
    sound: false,
    interactive: true,
    font: "500 14px 'Inter', system-ui, sans-serif",
    ink: "#0F1B24",
    plate: "rgba(255,255,255,0.86)",
    accent: "#2B3BFF",
    hint: true,
    loaderTitle: "",
    loaderSubtitle: "",
    loaderMark: true,
}
const H = 18 // cruise altitude

// ---------- small utils
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, t) => a + (b - a) * t
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt))
const wrapPI = (a) => {
    while (a > Math.PI) a -= Math.PI * 2
    while (a < -Math.PI) a += Math.PI * 2
    return a
}
function rng(seed) {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = s
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const C = (h) => new THREE.Color(h)

const PAL = {
    day: {
        zenith: C("#3f67c4"),
        horizon: C("#ffb886"),
        sun: C("#ffc27a"),
        fog: C("#f6c7a4"),
        cloudLit: C("#ffe2bf"),
        cloudShade: C("#a493c4"),
        sunI: 3.4,
        hemiI: 1.15,
        hemiSky: C("#ffe9d6"),
        hemiGround: C("#b9a2c9"),
        exposure: 1.08,
        stars: 0,
        glow: 0,
    },
    night: {
        zenith: C("#040a1e"),
        horizon: C("#1d2a4c"),
        sun: C("#9fb4ff"),
        fog: C("#17223e"),
        cloudLit: C("#7486c4"),
        cloudShade: C("#1b2547"),
        sunI: 0.75,
        hemiI: 0.55,
        hemiSky: C("#5a72c4"),
        hemiGround: C("#1a2244"),
        exposure: 0.95,
        stars: 1,
        glow: 1,
    },
}

function createSkyArchipelago(container, opts = {}) {
    const o = Object.assign({}, DEFAULTS, opts)
    o.islands = (
        opts.islands && opts.islands.length
            ? opts.islands
            : DEFAULTS.islands
    ).map((i) => ({ ...i }))
    const win = container.ownerDocument.defaultView || window
    const doc = container.ownerDocument
    const reduced =
        win.matchMedia &&
        win.matchMedia("(prefers-reduced-motion: reduce)").matches
    const coarse =
        win.matchMedia && win.matchMedia("(pointer: coarse)").matches

    // ---------- state
    const state = {
        night:
            o.timeOfDay === "night" ||
            (o.timeOfDay === "auto" &&
                (() => {
                    const h = new Date().getHours()
                    return h >= 19 || h < 6
                })())
                ? 1
                : 0,
        nightT: 0,
        docked: null,
        near: null,
        mode: "free",
        started: false,
        destroyed: false,
    }
    state.nightT = state.night
    const emit = (type, key = null, extra = null) => {
        const g = (win.__skyarch = win.__skyarch || {})
        g.active = true
        if (type === "arrive") g.docked = key
        if (type === "leave") g.docked = null
        if (type === "start") g.started = true
        win.dispatchEvent(
            new CustomEvent(EVT, {
                detail: Object.assign(
                    { type, key: key || null },
                    extra || {}
                ),
            })
        )
    }

    // ---------- renderer
    const root = doc.createElement("div")
    root.style.cssText =
        "position:absolute;inset:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;outline:none"
    root.tabIndex = 0
    root.setAttribute("role", "application")
    root.setAttribute(
        "aria-label",
        "Interactive map of the islands. Use the menu above to open a section, or click an island to fly there."
    )
    container.appendChild(root)
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
    })
    let dpr = Math.min(win.devicePixelRatio || 1, 1.5)
    renderer.setPixelRatio(dpr)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;display:block"
    root.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2400)
    scene.fog = new THREE.Fog(PAL.day.fog.clone(), 140, 760)

    // ---------- sky dome
    const skyU = {
        uZenith: { value: PAL.day.zenith.clone() },
        uHorizon: { value: PAL.day.horizon.clone() },
        uSun: { value: PAL.day.sun.clone() },
        uSunDir: { value: new THREE.Vector3(0.42, 0.2, -0.88).normalize() },
        uStars: { value: 0 },
        uTime: { value: 0 },
    }
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(1800, 32, 16),
        new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: skyU,
            vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
            fragmentShader: `uniform vec3 uZenith,uHorizon,uSun,uSunDir; uniform float uStars,uTime; varying vec3 vDir;
        float h(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d=normalize(vDir); float y=clamp(d.y,-.2,1.);
          float t=smoothstep(0.,.5,y); t=t*t*(3.-2.*t);
          vec3 col=mix(uHorizon,uZenith,t);
          col=mix(col,uHorizon*0.92,smoothstep(0.,-.2,d.y));
          float s=max(dot(d,uSunDir),0.);
          col+=uSun*(pow(s,4.)*.45+pow(s,48.)*.7)*(1.-uStars*.6); col=mix(col,col*vec3(1.08,.96,.9),(1.-t)*.5*(1.-uStars));
          col+=uSun*smoothstep(.9985,.9992,s)*1.4;
          if(uStars>0.){ vec3 q=floor(d*420.); float st=step(.9965,h(q)); float tw=.6+.4*sin(uTime*2.+h(q+3.)*40.); col+=vec3(st*tw*uStars*smoothstep(.02,.3,d.y)); }
          gl_FragColor=vec4(col,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
        })
    )
    scene.add(sky)

    // ---------- lights
    const hemi = new THREE.HemisphereLight(
        PAL.day.hemiSky.clone(),
        PAL.day.hemiGround.clone(),
        PAL.day.hemiI
    )
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(
        PAL.day.sun.clone(),
        PAL.day.sunI
    )
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    const sc = sun.shadow.camera
    sc.left = -70
    sc.right = 70
    sc.top = 70
    sc.bottom = -70
    sc.near = 1
    sc.far = 260
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.04
    scene.add(sun)
    scene.add(sun.target)

    // ---------- cloud sea (shader plane)
    const seaU = {
        uTime: { value: 0 },
        uLit: { value: PAL.day.cloudLit.clone() },
        uShade: { value: PAL.day.cloudShade.clone() },
        uFog: { value: PAL.day.fog.clone() },
        uSunDir: skyU.uSunDir,
        uCam: { value: new THREE.Vector3() },
    }
    const sea = new THREE.Mesh(
        new THREE.PlaneGeometry(3600, 3600, 1, 1),
        new THREE.ShaderMaterial({
            uniforms: seaU,
            fog: false,
            depthWrite: true,
            vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
            fragmentShader: `uniform float uTime; uniform vec3 uLit,uShade,uFog,uSunDir,uCam; varying vec3 vW;
        vec2 hh(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return -1.+2.*fract(sin(p)*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p),f=fract(p); vec2 u=f*f*(3.-2.*f);
          return mix(mix(dot(hh(i),f),dot(hh(i+vec2(1,0)),f-vec2(1,0)),u.x),mix(dot(hh(i+vec2(0,1)),f-vec2(0,1)),dot(hh(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y); }
        float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
        void main(){
          vec2 p=vW.xz*.009+vec2(uTime*.006,uTime*.0025);
          float c=fbm(p)+.5*fbm(p*2.7-uTime*.01);
          float e=.06; float cx=fbm(p+vec2(e,0.))-fbm(p-vec2(e,0.)); float cz=fbm(p+vec2(0.,e))-fbm(p-vec2(0.,e));
          vec3 nrm=normalize(vec3(-cx*6.,1.,-cz*6.));
          float l=clamp(dot(nrm,normalize(uSunDir+vec3(0.,.4,0.))),0.,1.);
          vec3 col=mix(uShade,uLit,smoothstep(-.35,.7,c*.9+l*.6));
          col+=uLit*pow(l,6.)*.22; col=mix(col,uShade*.85,smoothstep(.15,-.45,c)*.5);
          float d=length(vW.xz-uCam.xz);
          float f=smoothstep(220.,1100.,d)*.85;
          col=mix(col,uFog,f);
          gl_FragColor=vec4(col,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
        })
    )
    sea.rotation.x = -Math.PI / 2
    sea.position.y = -4
    scene.add(sea)

    // ---------- shared materials
    const M = (c, r = 0.9, extra = {}) =>
        new THREE.MeshStandardMaterial(
            Object.assign(
                {
                    color: C(c),
                    roughness: r,
                    metalness: 0,
                    flatShading: true,
                },
                extra
            )
        )
    const mats = {
        wood: M("#9a6b4f"),
        woodDark: M("#6b4a3a"),
        white: M("#f3efe8", 0.8),
        cream: M("#efe6d8", 0.85),
        roof: M("#c4664f"),
        roofBlue: M("#2c3f7a"),
        stone: M("#b9b2c4"),
        metal: M("#555d6e", 0.5, { metalness: 0.4 }),
        pine: M("#3e6648"),
        pine2: M("#4d7752"),
        leaf: M("#6f9a52"),
        leaf2: M("#8fb35c"),
        trunk: M("#7a5643"),
        flower: M("#e9a3b5"),
        gold: new THREE.MeshStandardMaterial({
            color: C("#d4a95c"),
            roughness: 0.35,
            metalness: 0.7,
        }),
        rock: M("#a69fb7"),
        rockDark: M("#7f7895"),
        books: [M("#d6694f"), M("#e2b04a"), M("#3d5aa8"), M("#6f9a7a")],
        lamp: new THREE.MeshStandardMaterial({
            color: C("#fff1c9"),
            emissive: C("#ffb45c"),
            emissiveIntensity: 0.0,
            roughness: 0.5,
        }),
        window: new THREE.MeshStandardMaterial({
            color: C("#2d3550"),
            emissive: C("#ffc77a"),
            emissiveIntensity: 0.0,
            roughness: 0.3,
        }),
        beacon: new THREE.MeshStandardMaterial({
            color: C(o.accent),
            emissive: C(o.accent),
            emissiveIntensity: 1.5,
            roughness: 0.4,
        }),
    }
    const glows = [] // emissive mats that brighten at night

    // ---------- islands
    const world = new THREE.Group()
    scene.add(world)
    const islandShape = (isl, a) =>
        isl.r *
        (1 +
            0.075 * Math.sin(a * 3 + isl.seed) +
            0.05 * Math.sin(a * 5 + isl.seed * 2.1) +
            0.03 * Math.sin(a * 9 + isl.seed * 3.3))
    const topY = (isl, x, z) => {
        const d = Math.hypot(x, z) / isl.r
        return isl.top + 0.9 * Math.max(0, 1 - d * d)
    }
    function buildIslandGeo(isl) {
        const rand = rng(isl.seed * 977 + 13)
        const N = 44,
            K = 7
        const pos = [],
            col = []
        const grassA = C(isl.grassA || "#93b56b"),
            grassB = C(isl.grassB || "#6c9455"),
            soil = C("#8a5b44"),
            rockA = C("#cdbfae"),
            rockB = C("#a3958c"),
            rockC = C("#756a72")
        const rings = []
        for (let k = 0; k <= K; k++) {
            const t = k / K
            const ring = []
            for (let i = 0; i < N; i++) {
                const a = (i / N) * Math.PI * 2
                let rad = islandShape(isl, a)
                let y = isl.top
                if (k === 0) {
                    y = isl.top
                } else if (k === 1) {
                    rad *= 0.97
                    y = isl.top - 1.1
                } else {
                    const tt = (k - 1) / (K - 1)
                    const prof =
                        tt < 0.35
                            ? 1 - tt * 0.35
                            : (1 - 0.1225) *
                              (1 - Math.pow((tt - 0.35) / 0.65, 0.9) * 0.97)
                    rad *= prof * (0.9 + rand() * 0.18)
                    y =
                        isl.top -
                        1.1 -
                        tt * isl.depth * (0.9 + rand() * 0.2)
                }
                ring.push([Math.cos(a) * rad, y, Math.sin(a) * rad])
            }
            rings.push(ring)
        }
        const tip = [0, isl.top - isl.depth * 1.18, 0]
        const push = (p, c) => {
            pos.push(p[0], p[1], p[2])
            col.push(c.r, c.g, c.b)
        }
        const rockCol = (y) => {
            const t = clamp((isl.top - y) / isl.depth, 0, 1)
            return t < 0.5
                ? rockA.clone().lerp(rockB, t * 2)
                : rockB.clone().lerp(rockC, (t - 0.5) * 2)
        }
        // top cap
        const ctr = [0, topY(isl, 0, 0), 0]
        const top = rings[0]
        for (let i = 0; i < N; i++) {
            const a = top[i],
                b = top[(i + 1) % N]
            const mid1 = [
                a[0] * 0.55,
                topY(isl, a[0] * 0.55, a[2] * 0.55),
                a[2] * 0.55,
            ]
            const mid2 = [
                b[0] * 0.55,
                topY(isl, b[0] * 0.55, b[2] * 0.55),
                b[2] * 0.55,
            ]
            const g1 = grassA.clone().lerp(grassB, rand() * 0.6),
                g2 = grassA.clone().lerp(grassB, rand() * 0.6)
            push(ctr, g1)
            push(mid2, g1)
            push(mid1, g1)
            push(mid1, g2)
            push(mid2, g2)
            push(b, g2)
            push(mid1, g1)
            push(b, g1)
            push(a, g1)
        }
        // sides
        for (let k = 0; k < K; k++) {
            const r0 = rings[k],
                r1 = rings[k + 1]
            for (let i = 0; i < N; i++) {
                const a0 = r0[i],
                    b0 = r0[(i + 1) % N],
                    a1 = r1[i],
                    b1 = r1[(i + 1) % N]
                const c =
                    k === 0
                        ? soil.clone().lerp(C("#6d4636"), rand() * 0.4)
                        : rockCol((a1[1] + a0[1]) / 2).multiplyScalar(
                              0.94 + rand() * 0.12
                          )
                push(a0, c)
                push(b1, c)
                push(a1, c)
                push(a0, c)
                push(b0, c)
                push(b1, c)
            }
        }
        const last = rings[K]
        for (let i = 0; i < N; i++) {
            const c = rockC.clone().multiplyScalar(0.9 + rand() * 0.2)
            push(last[i], c)
            push(last[(i + 1) % N], c)
            push(tip, c)
        }
        const g = new THREE.BufferGeometry()
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
        g.computeVertexNormals()
        return g
    }
    const islandMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.95,
    })

    const mesh = (geo, mat, x = 0, y = 0, z = 0, cast = true) => {
        const m = new THREE.Mesh(geo, mat)
        m.position.set(x, y, z)
        m.castShadow = cast
        m.receiveShadow = true
        return m
    }
    const G = {
        box: new THREE.BoxGeometry(1, 1, 1),
        cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
        cyl12: new THREE.CylinderGeometry(1, 1, 1, 12),
        cone7: new THREE.ConeGeometry(1, 1, 7),
        cone4: new THREE.ConeGeometry(1, 1, 4),
        ico: new THREE.IcosahedronGeometry(1, 0),
        ico1: new THREE.IcosahedronGeometry(1, 1),
        dodec: new THREE.DodecahedronGeometry(1, 0),
        sph: new THREE.SphereGeometry(1, 12, 8),
        prism: (() => {
            const s = new THREE.Shape()
            s.moveTo(-0.5, 0)
            s.lineTo(0.5, 0)
            s.lineTo(0, 0.6)
            s.lineTo(-0.5, 0)
            const g = new THREE.ExtrudeGeometry(s, {
                depth: 1,
                bevelEnabled: false,
            })
            g.translate(0, 0, -0.5)
            return g
        })(),
    }
    const sized = (geo, mat, sx, sy, sz, x, y, z) => {
        const m = mesh(geo, mat, x, y, z)
        m.scale.set(sx, sy, sz)
        return m
    }

    function tree(parent, x, z, y, s, rand, kind) {
        const g = new THREE.Group()
        g.position.set(x, y, z)
        g.scale.setScalar(s)
        g.rotation.y = rand() * 6.28
        g.add(sized(G.cyl6, mats.trunk, 0.18, 1.1, 0.18, 0, 0.55, 0))
        if (kind === "pine") {
            g.add(sized(G.cone7, mats.pine, 0.95, 1.8, 0.95, 0, 1.7, 0))
            g.add(sized(G.cone7, mats.pine2, 0.7, 1.4, 0.7, 0, 2.5, 0))
        } else {
            g.add(
                sized(
                    G.ico,
                    rand() > 0.5 ? mats.leaf : mats.leaf2,
                    1.05,
                    0.95,
                    1.05,
                    0,
                    1.75,
                    0
                )
            )
            g.add(sized(G.ico, mats.leaf2, 0.6, 0.6, 0.6, 0.55, 2.2, 0.2))
        }
        parent.add(g)
    }
    function rock(parent, x, y, z, s, rand) {
        const m = sized(
            G.dodec,
            rand() > 0.5 ? mats.rock : mats.rockDark,
            s,
            s * 0.7,
            s * 0.9,
            x,
            y,
            z
        )
        m.rotation.set(rand(), rand() * 6, rand())
        parent.add(m)
    }
    function lantern(parent, x, y, z) {
        const g = new THREE.Group()
        g.position.set(x, y, z)
        g.add(sized(G.cyl6, mats.woodDark, 0.07, 1.6, 0.07, 0, 0.8, 0))
        const l = sized(G.sph, mats.lamp, 0.2, 0.26, 0.2, 0, 1.7, 0)
        l.castShadow = false
        g.add(l)
        parent.add(g)
    }
    const glowTex = (() => {
        const c = doc.createElement("canvas")
        c.width = c.height = 64
        const x = c.getContext("2d")
        const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32)
        gr.addColorStop(0, "rgba(255,255,255,1)")
        gr.addColorStop(0.25, "rgba(255,255,255,.55)")
        gr.addColorStop(1, "rgba(255,255,255,0)")
        x.fillStyle = gr
        x.fillRect(0, 0, 64, 64)
        const t = new THREE.CanvasTexture(c)
        return t
    })()
    const glowSprites = []
    function glow(parent, x, y, z, s, color) {
        const sp = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: glowTex,
                color: C(color),
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                opacity: 0,
            })
        )
        sp.position.set(x, y, z)
        sp.scale.setScalar(s)
        parent.add(sp)
        glowSprites.push(sp)
        return sp
    }

    // building kits
    const kits = {
        studio(g, isl, rand) {
            const y = topY(isl, 0, 0)
            const b = new THREE.Group()
            b.position.set(-1, y - 0.1, 1)
            b.rotation.y = 0.5
            g.add(b)
            b.add(sized(G.box, mats.cream, 6, 3.2, 4.2, 0, 1.6, 0))
            const roof = sized(G.prism, mats.roof, 7, 3.4, 4.8, 0, 3.2, 0)
            roof.rotation.y = Math.PI / 2
            roof.scale.set(4.8, 3.4, 7)
            b.add(roof)
            b.add(sized(G.box, mats.window, 3.4, 1.6, 0.1, -0.6, 1.7, 2.12))
            b.add(sized(G.box, mats.woodDark, 0.9, 1.9, 0.1, 2, 0.95, 2.12))
            b.add(sized(G.box, mats.stone, 0.7, 2.2, 0.7, 2, 5, -1))
            b.add(sized(G.box, mats.wood, 7, 0.25, 2.2, 0, 0.12, 3.3))
            glow(b, -0.6, 1.7, 2.6, 6, "#ffcf8a")
            b.userData.smoke = new THREE.Vector3(2, 6.4, -1)
            g.userData.smokeFrom = b
            return [
                [-6, 4],
                [5, 6],
                [6, -5],
                [-7, -5],
                [2, -8],
                [-3, 8],
            ]
        },
        gallery(g, isl, rand) {
            const y = topY(isl, 0, 0)
            const b = new THREE.Group()
            b.position.set(0, y - 0.1, 0)
            b.rotation.y = -0.4
            g.add(b)
            b.add(sized(G.box, mats.stone, 11, 0.5, 8, 0, 0.25, 0))
            for (const [cx, cz] of [
                [-5, -3.5],
                [5, -3.5],
                [-5, 3.5],
                [5, 3.5],
                [0, -3.5],
                [0, 3.5],
            ])
                b.add(
                    sized(G.cyl12, mats.white, 0.28, 4, 0.28, cx, 2.5, cz)
                )
            b.add(sized(G.box, mats.white, 12, 0.45, 9, 0, 4.7, 0))
            b.add(sized(G.box, mats.roofBlue, 12.2, 0.18, 9.2, 0, 4.98, 0))
            const frames = []
            for (let i = 0; i < 3; i++) {
                const f = new THREE.Group()
                f.position.set(-3.6 + i * 3.6, 0.5, 0.2)
                b.add(f)
                f.add(
                    sized(G.box, mats.woodDark, 2.6, 3.2, 0.18, 0, 1.9, 0)
                )
                const art = new THREE.Mesh(
                    new THREE.PlaneGeometry(2.3, 2.9),
                    new THREE.MeshStandardMaterial({
                        color: C(["#d9c7b5", "#9fb1c9", "#c7a6a0"][i]),
                        roughness: 0.7,
                    })
                )
                art.position.set(0, 1.9, 0.1)
                f.add(art)
                frames.push(art)
                const back = art.clone()
                back.rotation.y = Math.PI
                back.position.z = -0.1
                f.add(back)
                frames.push(back)
            }
            g.userData.frames = frames
            glow(b, 0, 4.2, 0, 10, "#ffe2b0")
            return [
                [-8, 6],
                [8, 7],
                [9, -6],
                [-9, -6],
                [0, 10],
                [-2, -10],
            ]
        },
        library(g, isl, rand) {
            const y = topY(isl, 0, 0)
            const b = new THREE.Group()
            b.position.set(0, y - 0.1, 0)
            g.add(b)
            b.add(sized(G.cyl12, mats.cream, 2.6, 6.5, 2.6, 0, 3.25, 0))
            const roof = sized(G.cone7, mats.roofBlue, 3.2, 3, 3.2, 0, 8, 0)
            b.add(roof)
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2
                const w = sized(
                    G.box,
                    mats.window,
                    0.6,
                    1.1,
                    0.1,
                    Math.cos(a) * 2.58,
                    4.4,
                    Math.sin(a) * 2.58
                )
                w.rotation.y = -a + Math.PI / 2
                b.add(w)
            }
            b.add(sized(G.box, mats.woodDark, 1, 1.9, 0.2, 0, 0.95, 2.55))
            for (let i = 0; i < 6; i++) {
                const bk = sized(
                    G.box,
                    mats.books[i % 4],
                    1.6,
                    0.45,
                    1.1,
                    4.2,
                    0.25 + i * 0.45,
                    1.5
                )
                bk.rotation.y = rand() * 0.6 - 0.3
                b.add(bk)
            }
            glow(b, 0, 4.4, 0, 9, "#ffd395")
            return [
                [-6, 3],
                [6, -4],
                [-4, -6],
                [3, 7],
                [-7, -2],
            ]
        },
        beacon(g, isl, rand) {
            const y = topY(isl, 0, 0)
            const b = new THREE.Group()
            b.position.set(0, y - 0.1, 0)
            g.add(b)
            const hgt = 13
            for (const [sx, sz] of [
                [-1, -1],
                [1, -1],
                [-1, 1],
                [1, 1],
            ]) {
                const leg = sized(
                    G.cyl6,
                    mats.white,
                    0.16,
                    hgt,
                    0.16,
                    sx * 1.15,
                    hgt / 2,
                    sz * 1.15
                )
                leg.rotation.set(sz * 0.07, 0, -sx * 0.07)
                b.add(leg)
            }
            for (let k = 1; k < 5; k++) {
                const yy = k * 2.6
                const w = 2.4 - k * 0.32
                b.add(
                    sized(
                        G.box,
                        k % 2 ? mats.white : mats.roof,
                        w,
                        0.18,
                        w,
                        0,
                        yy,
                        0
                    )
                )
            }
            b.add(sized(G.box, mats.cream, 2.4, 1.8, 2.4, 0, hgt + 0.6, 0))
            b.add(
                sized(G.cone4, mats.roof, 2.2, 1.3, 2.2, 0, hgt + 2.15, 0)
            )
            const lamp = sized(
                G.sph,
                mats.beacon,
                0.55,
                0.55,
                0.55,
                0,
                hgt + 3.2,
                0
            )
            lamp.castShadow = false
            b.add(lamp)
            g.userData.lamp = lamp
            g.userData.lampGlow = glow(b, 0, hgt + 3.2, 0, 7, o.accent)
            // rotating beams (night)
            const beamGeo = new THREE.ConeGeometry(2.4, 60, 24, 1, true)
            beamGeo.translate(0, -30, 0)
            beamGeo.rotateZ(Math.PI / 2)
            const beamMat = new THREE.MeshBasicMaterial({
                color: C("#cfd8ff"),
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                fog: false,
            })
            const beams = new THREE.Group()
            beams.position.set(0, hgt + 3.2, 0)
            const b1 = new THREE.Mesh(beamGeo, beamMat),
                b2 = new THREE.Mesh(beamGeo, beamMat)
            b2.rotation.y = Math.PI
            beams.add(b1, b2)
            b.add(beams)
            g.userData.beams = beams
            g.userData.beamMat = beamMat
            b.add(sized(G.box, mats.cream, 3, 2, 2.4, 3.6, 1, -1.2))
            // Add the annex roof as a mesh (Vector3.scale.set returns a vector, not a mesh)
            b.add(sized(G.prism, mats.roof, 2.6, 1.6, 3.2, 3.6, 2, -1.2))
            return [
                [-5, 4],
                [5, 4],
                [-4, -5],
                [5, -4],
            ]
        },
    }

    const islands = []
    const allIslands = []
    o.islands.forEach((def, idx) => {
        const isl = Object.assign(
            { seed: idx * 3 + 1.7, top: 12.5, depth: def.r * 1.25 },
            def
        )
        isl.content = true
        allIslands.push(isl)
    })
    // decorative islets
    const rI = rng(42)
    const ringPts = [
        [-118, 34],
        [-104, -66],
        [8, -52],
        [-44, 52],
        [118, 26],
        [104, -84],
        [-70, -142],
        [74, -160],
        [150, -40],
        [-160, -18],
        [52, 86],
        [-96, 112],
        [-20, -160],
        [160, 70],
    ]
    ringPts.forEach(([x, z], i) =>
        allIslands.push({
            key: "islet" + i,
            content: false,
            x,
            z,
            r: 4 + rI() * 5,
            seed: 20 + i * 1.3,
            top: 8 + rI() * 10,
            depth: 6 + rI() * 6,
            kind: "islet",
        })
    )

    allIslands.forEach((isl) => {
        const g = new THREE.Group()
        g.position.set(isl.x, 0, isl.z)
        const m = new THREE.Mesh(buildIslandGeo(isl), islandMat)
        m.castShadow = true
        m.receiveShadow = true
        m.userData.key = isl.content ? isl.key : null
        g.add(m)
        const rand = rng(isl.seed * 31 + 7)
        let spots = []
        if (isl.content && kits[isl.kind])
            spots = kits[isl.kind](g, isl, rand)
        else {
            for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) {
                const a = rand() * 6.28,
                    d = rand() * isl.r * 0.6
                spots.push([Math.cos(a) * d, Math.sin(a) * d])
            }
        }
        spots.forEach(([x, z], i) => {
            if (Math.hypot(x, z) < isl.r * 0.82)
                tree(
                    g,
                    x,
                    z,
                    topY(isl, x, z) - 0.1,
                    0.8 + rand() * 0.7,
                    rand,
                    (i + isl.seed) % 3 < 1 ? "pine" : "round"
                )
        })
        const extra = isl.content ? 9 : 3
        for (let i = 0; i < extra; i++) {
            const a = rand() * 6.28,
                d = isl.r * (0.62 + rand() * 0.25)
            const x = Math.cos(a) * d,
                z = Math.sin(a) * d
            if (isl.content && Math.abs(wrapPI(a - isl.dock)) < 0.5)
                continue
            tree(
                g,
                x,
                z,
                topY(isl, x, z) - 0.1,
                0.7 + rand() * 0.8,
                rand,
                rand() < 0.4 ? "pine" : "round"
            )
        }
        for (let i = 0; i < (isl.content ? 16 : 6); i++) {
            const a = rand() * 6.28,
                d = isl.r * (0.84 + rand() * 0.12)
            const x = Math.cos(a) * d,
                z = Math.sin(a) * d
            if (isl.content && Math.abs(wrapPI(a - isl.dock)) < 0.35)
                continue
            const bm = sized(
                G.ico,
                rand() < 0.15
                    ? mats.flower
                    : rand() < 0.5
                      ? mats.leaf
                      : mats.leaf2,
                0.6 + rand() * 0.6,
                0.45 + rand() * 0.4,
                0.6 + rand() * 0.6,
                x,
                topY(isl, x, z) + 0.15,
                z
            )
            g.add(bm)
        }
        for (let i = 0; i < 4; i++) {
            const a = rand() * 6.28,
                d = isl.r * (0.75 + rand() * 0.2)
            rock(
                g,
                Math.cos(a) * d,
                topY(isl, Math.cos(a) * d, Math.sin(a) * d) + 0.1,
                Math.sin(a) * d,
                0.5 + rand() * 0.7,
                rand
            )
        }
        // dock
        if (isl.content) {
            const a = isl.dock
            const edge = islandShape(isl, a) * 0.92
            const dx = Math.cos(a),
                dz = Math.sin(a)
            const len = 7
            const pier = new THREE.Group()
            pier.position.set(dx * edge, isl.top + 0.2, dz * edge)
            pier.rotation.y = -a
            pier.add(sized(G.box, mats.wood, len, 0.3, 2.2, len / 2, 0, 0))
            for (let k = 0; k <= 3; k++)
                (pier.add(
                    sized(
                        G.cyl6,
                        mats.woodDark,
                        0.12,
                        2.2,
                        0.12,
                        (k / 3) * len,
                        -0.9,
                        1.05
                    )
                ),
                    pier.add(
                        sized(
                            G.cyl6,
                            mats.woodDark,
                            0.12,
                            2.2,
                            0.12,
                            (k / 3) * len,
                            -0.9,
                            -1.05
                        )
                    ))
            pier.add(
                sized(
                    G.cyl6,
                    mats.metal,
                    0.14,
                    5.2,
                    0.14,
                    len - 0.3,
                    2.6,
                    0
                )
            )
            pier.add(
                sized(
                    G.cyl12,
                    mats.metal,
                    0.5,
                    0.12,
                    0.5,
                    len - 0.3,
                    5.1,
                    0
                )
            )
            lantern(pier, 1.5, 0.15, 1.2)
            lantern(pier, 4.6, 0.15, -1.2)
            glow(pier, 1.5, 1.85, 1.2, 2.2, "#ffc37a")
            glow(pier, 4.6, 1.85, -1.2, 2.2, "#ffc37a")
            g.add(pier)
            const tipD = edge + len - 1.5
            const sx = -dz,
                sz = dx
            isl.dockPos = new THREE.Vector3(
                isl.x + dx * tipD + sx * 4.2,
                H - 0.6,
                isl.z + dz * tipD + sz * 4.2
            )
            isl.dockYaw = Math.atan2(dx, dz) // nose towards the island, alongside the pier
            isl.dockDir = new THREE.Vector2(dx, dz)
        }
        // waterfall on studio island
        if (isl.kind === "studio" || isl.kind === "library") {
            const a = isl.dock + (isl.kind === "studio" ? 2.4 : -2.2),
                edge = islandShape(isl, a) * 0.96
            const wf = new THREE.Mesh(
                new THREE.PlaneGeometry(2.2, 26, 1, 1),
                new THREE.ShaderMaterial({
                    transparent: true,
                    depthWrite: false,
                    uniforms: { uTime: seaU.uTime },
                    fog: false,
                    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
                    fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){ float s=fract(vUv.y*6.+uTime*1.4+sin(vUv.x*20.)*.05); float a=smoothstep(0.,.15,vUv.x)*smoothstep(1.,.85,vUv.x)*smoothstep(0.,.5,vUv.y); vec3 c=mix(vec3(.75,.85,1.),vec3(1.),step(.6,s)); gl_FragColor=vec4(c,a*.75); }`,
                })
            )
            wf.position.set(
                Math.cos(a) * edge,
                isl.top - 12,
                Math.sin(a) * edge
            )
            wf.lookAt(Math.cos(a) * 100, isl.top - 12, Math.sin(a) * 100)
            g.add(wf)
        }
        g.userData.isl = isl
        isl.group = g
        isl.mesh = m
        world.add(g)
        if (isl.content) islands.push(isl)
    })

    // ---------- merge static props per island (one draw call per material instead of one per prop)
    const invM = new THREE.Matrix4(),
        relM = new THREE.Matrix4(),
        nrmM = new THREE.Matrix3()
    allIslands.forEach((isl) => {
        const g = isl.group,
            u = g.userData
        g.updateMatrixWorld(true)
        invM.copy(g.matrixWorld).invert()
        const skip = new Set([isl.mesh])
        ;(u.frames || []).forEach((f) => skip.add(f))
        if (u.beams) u.beams.traverse((m) => skip.add(m))
        const buckets = new Map()
        g.traverse((m) => {
            if (
                !m.isMesh ||
                skip.has(m) ||
                !m.material ||
                !m.material.isMeshStandardMaterial ||
                m.material.transparent
            )
                return
            const k = m.material.uuid + (m.castShadow ? "|c" : "|n")
            if (!buckets.has(k))
                buckets.set(k, {
                    mat: m.material,
                    cast: m.castShadow,
                    list: [],
                })
            buckets.get(k).list.push(m)
        })
        buckets.forEach((b) => {
            if (b.list.length < 2) return
            let n = 0
            const parts = []
            for (const m of b.list) {
                relM.multiplyMatrices(invM, m.matrixWorld)
                nrmM.getNormalMatrix(relM)
                let geo = m.geometry.index
                    ? m.geometry.toNonIndexed()
                    : m.geometry.clone()
                const p = geo
                    .getAttribute("position")
                    .clone()
                    .applyMatrix4(relM)
                const nr = geo.getAttribute("normal")
                    ? geo
                          .getAttribute("normal")
                          .clone()
                          .applyNormalMatrix(nrmM)
                    : null
                parts.push([p, nr])
                n += p.count
                if (geo !== m.geometry) geo.dispose()
            }
            const pos = new Float32Array(n * 3),
                nor = new Float32Array(n * 3)
            let o3 = 0
            for (const [p, nr] of parts) {
                pos.set(p.array, o3)
                if (nr) nor.set(nr.array, o3)
                o3 += p.count * 3
            }
            const geo = new THREE.BufferGeometry()
            geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
            geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3))
            geo.computeBoundingSphere()
            const merged = new THREE.Mesh(geo, b.mat)
            merged.castShadow = b.cast
            merged.receiveShadow = true
            merged.matrixAutoUpdate = false
            if (u.lamp && b.list.includes(u.lamp)) return // keep the animated lamp alone
            b.list.forEach((m) => m.parent && m.parent.remove(m))
            g.add(merged)
        })
        g.traverse((m) => {
            if (m !== g && !m.isSprite) {
                m.updateMatrix()
                if (
                    !(
                        u.beams &&
                        (m === u.beams || u.beams.children.includes(m))
                    ) &&
                    !(u.frames || []).includes(m) &&
                    m.isMesh &&
                    !m.material.isShaderMaterial
                )
                    m.matrixAutoUpdate = false
            }
        })
    })

    // gallery artwork textures
    const texLoader = new THREE.TextureLoader()
    texLoader.setCrossOrigin("anonymous")
    const gal = islands.find((i) => i.kind === "gallery")
    if (gal && o.images && o.images.length) {
        const frames = gal.group.userData.frames || []
        frames.forEach((f, i) => {
            let url = o.images[Math.floor(i / 2) % o.images.length]
            if (!url) return
            if (
                /framerusercontent\.com/.test(url) &&
                !/scale-down-to/.test(url)
            )
                url += (url.includes("?") ? "&" : "?") + "scale-down-to=512"
            texLoader.load(url, (t) => {
                t.colorSpace = THREE.SRGBColorSpace
                t.anisotropy = 4
                f.material = new THREE.MeshStandardMaterial({
                    map: t,
                    roughness: 0.6,
                })
                f.material.needsUpdate = true
            })
        })
    }

    // ---------- puffy clouds (instanced)
    const puffGeo = new THREE.IcosahedronGeometry(1, 2)
    const puffMat = new THREE.MeshStandardMaterial({
        color: C("#fff3e4"),
        emissive: C("#9d8fc4"),
        emissiveIntensity: 0.38,
        roughness: 1,
        flatShading: false,
    })
    const PUFF = coarse ? 520 : 900
    const puffs = new THREE.InstancedMesh(puffGeo, puffMat, PUFF)
    puffs.castShadow = false
    puffs.receiveShadow = false
    const pr = rng(7),
        dummy = new THREE.Object3D(),
        puffData = []
    let pi = 0
    const clusters = Math.floor(PUFF / 7)
    for (let c = 0; c < clusters && pi < PUFF; c++) {
        const a = pr() * 6.28,
            d = 30 + pr() * 420,
            cx = Math.cos(a) * d,
            cz = Math.sin(a) * d - 60
        const high = pr() < 0.22 && d > 150
        const cy = high ? 26 + pr() * 22 : -3.5 + pr() * 2
        const big = high ? 3 + pr() * 3 : 5 + pr() * 7
        const n = 4 + Math.floor(pr() * 5)
        for (let k = 0; k < n && pi < PUFF; k++, pi++) {
            const s = big * (0.5 + pr() * 0.6)
            puffData.push({
                x: cx + (pr() - 0.5) * big * 2.6,
                y: cy + pr() * s * 0.4,
                z: cz + (pr() - 0.5) * big * 1.6,
                s,
                sp: (high ? 0.9 : 0.35) * (0.6 + pr() * 0.8),
            })
        }
    }
    for (const isl of allIslands) {
        const n = isl.content ? 9 : 4
        for (let k = 0; k < n && pi < PUFF; k++, pi++) {
            const a = pr() * 6.28,
                d = isl.r * (0.5 + pr() * 0.9),
                s = isl.r * (0.32 + pr() * 0.3)
            puffData.push({
                x: isl.x + Math.cos(a) * d,
                y: isl.top - isl.depth * (0.75 + pr() * 0.4),
                z: isl.z + Math.sin(a) * d,
                s,
                sp: 0,
                anchored: true,
            })
        }
    }
    puffs.count = pi
    scene.add(puffs)
    const updatePuffs = (t) => {
        for (let i = 0; i < pi; i++) {
            const p = puffData[i]
            let x = p.anchored
                ? p.x + Math.sin(t * 0.1 + i) * 0.8
                : ((((p.x + t * p.sp + 500) % 1000) + 1000) % 1000) - 500
            dummy.position.set(x, p.y, p.z)
            dummy.scale.set(p.s, p.s * 0.62, p.s * 0.85)
            dummy.updateMatrix()
            puffs.setMatrixAt(i, dummy.matrix)
        }
        puffs.instanceMatrix.needsUpdate = true
    }
    puffs.frustumCulled = false
    updatePuffs(0)

    // ---------- birds
    const birdGeo = new THREE.BufferGeometry()
    birdGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
            [
                0, 0, 0.35, -1, 0.1, -0.1, 0, 0, -0.25, 0, 0, 0.35, 0, 0,
                -0.25, 1, 0.1, -0.1,
            ],
            3
        )
    )
    birdGeo.computeVertexNormals()
    const birdMat = new THREE.MeshStandardMaterial({
        color: C("#3b3f52"),
        side: THREE.DoubleSide,
        roughness: 1,
    })
    const birds = []
    const br = rng(99)
    for (let f = 0; f < 3; f++) {
        const cx = (br() - 0.5) * 160,
            cz = -40 - br() * 80
        for (let i = 0; i < 5; i++) {
            const m = new THREE.Mesh(birdGeo, birdMat)
            m.scale.setScalar(0.9 + br() * 0.4)
            scene.add(m)
            birds.push({
                m,
                cx: cx + (br() - 0.5) * 10,
                cz: cz + (br() - 0.5) * 10,
                r: 18 + br() * 16,
                y: 26 + br() * 10,
                sp: (0.18 + br() * 0.1) * (f % 2 ? 1 : -1),
                ph: br() * 6.28,
            })
        }
    }

    // ---------- smoke (studio chimney)
    const smoke = []
    const smokeMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: C("#ffffff"),
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
    })
    const studio = islands.find((i) => i.kind === "studio")
    for (let i = 0; i < 10; i++) {
        const s = new THREE.Sprite(smokeMat.clone())
        s.userData.t = i / 10
        scene.add(s)
        smoke.push(s)
    }

    // ---------- airship
    const ship = new THREE.Group()
    const env = new THREE.Group()
    ship.add(env)
    const envMat = new THREE.MeshStandardMaterial({
        color: C(o.envelope),
        roughness: 0.55,
        metalness: 0.05,
        flatShading: true,
    })
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), envMat)
    e1.scale.set(2.3, 2.3, 6.2)
    e1.castShadow = true
    env.add(e1)
    const band = new THREE.Mesh(
        new THREE.CylinderGeometry(2.33, 2.33, 0.28, 40, 1, true),
        mats.gold
    )
    band.rotation.x = Math.PI / 2
    band.position.z = -1.6
    band.material.side = THREE.DoubleSide
    env.add(band)
    const band2 = band.clone()
    band2.position.z = -2.3
    band2.scale.set(0.97, 0.4, 0.97)
    env.add(band2)
    const nose = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 10),
        mats.gold
    )
    nose.position.z = -6.05
    env.add(nose)
    const finMat = M("#f4efe6", 0.6)
    for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 1.5, 2.1),
            finMat
        )
        fin.castShadow = true
        const a = (i / 4) * Math.PI * 2
        fin.position.set(Math.cos(a) * 1.45, Math.sin(a) * 1.45, 5.1)
        fin.rotation.z = a - Math.PI / 2
        fin.rotation.x = 0
        env.add(fin)
    }
    const gondola = new THREE.Group()
    gondola.position.set(0, -3.05, -0.4)
    ship.add(gondola)
    gondola.add(sized(G.box, mats.wood, 1.6, 1.15, 3.6, 0, 0, 0))
    gondola.add(sized(G.box, mats.window, 1.64, 0.42, 2.6, 0, 0.12, -0.1))
    gondola.add(sized(G.box, mats.woodDark, 1.7, 0.16, 3.7, 0, -0.62, 0))
    for (const [x, z] of [
        [-0.6, -1.4],
        [0.6, -1.4],
        [-0.6, 1.4],
        [0.6, 1.4],
    ]) {
        const c = sized(G.cyl6, mats.metal, 0.04, 1.6, 0.04, x, 1.25, z)
        c.rotation.z = x > 0 ? -0.2 : 0.2
        gondola.add(c)
    }
    const prop = new THREE.Group()
    prop.position.set(0, 3.05, 6.6)
    gondola.add(prop)
    gondola.add(sized(G.box, mats.gold, 1.66, 0.08, 3.64, 0, 0.52, 0))
    gondola.add(sized(G.box, mats.gold, 1.66, 0.08, 3.64, 0, -0.3, 0))
    prop.add(
        sized(G.cyl12, mats.metal, 0.16, 0.5, 0.16, 0, 0, 0).rotateX(
            Math.PI / 2
        )
    )
    for (let i = 0; i < 3; i++) {
        const bl = sized(G.box, mats.woodDark, 0.16, 1.9, 0.06, 0, 0, 0.2)
        bl.geometry = G.box
        bl.rotation.z = (i / 3) * Math.PI * 2
        bl.position.set(
            Math.sin(bl.rotation.z) * 0.6,
            Math.cos(bl.rotation.z) * 0.6,
            0.2
        )
        prop.add(bl)
    }
    glow(gondola, 0, 0.12, -1.9, 2.5, "#ffd08a")
    ship.scale.setScalar(1.15)
    scene.add(ship)
    const shipShadowFix = () =>
        ship.traverse((m) => {
            if (m.isMesh) {
                m.castShadow = true
            }
        })
    shipShadowFix()

    // target marker
    const marker = new THREE.Mesh(
        new THREE.RingGeometry(1.2, 1.5, 40),
        new THREE.MeshBasicMaterial({
            color: C(o.accent),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
        })
    )
    marker.rotation.x = -Math.PI / 2
    scene.add(marker)

    // ---------- ship physics
    const sp = {
        x: 0,
        z: 62,
        yaw: 0,
        speed: 0,
        yawRate: 0,
        roll: 0,
        pitch: 0,
        lift: 0,
    }
    let auto = null // {x,z,key,dock}
    let backOff = null // gentle drift away from a pier after closing a panel
    let xfer = null // quick transfer to a dock: {key,t,T,p0..p3,yaw0,lift}
    let seen = false
    try {
        seen = win.sessionStorage.getItem("skyarch-seen") === "1"
    } catch (e) {}
    const keys = new Set()

    // ---------- camera rig
    const cam = {
        dist: coarse ? 40 : 36,
        distT: coarse ? 40 : 36,
        yawOff: 0.2,
        yawOffT: 0.2,
        pitch: 0.24,
        pitchT: 0.24,
        pos: new THREE.Vector3(0, 30, 110),
        look: new THREE.Vector3(0, H, 0),
        intro: reduced || seen ? 0 : 1,
        snap: false,
        vx: 0,
        vy: 0,
    }
    cam.yawOff = cam.yawOffT = 0.04

    // ---------- DOM UI
    const ui = doc.createElement("div")
    ui.style.cssText =
        "position:absolute;inset:0;pointer-events:none;font:" +
        o.font +
        ";color:" +
        o.ink
    root.appendChild(ui)
    const css = doc.createElement("style")
    css.textContent = `.sa-pill{position:absolute;left:0;top:0;border:0;font:inherit;color:inherit;transform:translate(-50%,-100%);padding:7px 14px;border-radius:999px;background:${o.plate};backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 6px 24px rgba(15,27,36,.12);white-space:nowrap;pointer-events:auto;cursor:pointer;transition:opacity .4s,transform .3s;display:flex;gap:8px;align-items:center;letter-spacing:-.01em}


.sa-pill:hover{filter:brightness(1.04)}
.sa-pill i{display:block;width:6px;height:6px;border-radius:9px;background:${o.accent}}
.sa-pill b{font-weight:500;opacity:.55}
.sa-pill[data-arrow]::after{content:attr(data-arrow);font-weight:600;color:${o.accent};margin-left:-2px}
.sa-pill:focus-visible,.sa-btn:focus-visible,.sa-prompt button:focus-visible{outline:2px solid ${o.accent};outline-offset:2px}
.sa-tip{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);padding:10px 16px;border-radius:999px;background:${o.plate};backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 6px 24px rgba(15,27,36,.12);white-space:nowrap;font-size:14px;transition:opacity .4s;pointer-events:none}
.sa-ctrl{position:absolute;left:28px;bottom:72px;display:flex;flex-direction:column;gap:8px;pointer-events:auto;transition:opacity .35s}
.sa-btn{width:42px;height:42px;border-radius:999px;border:0;background:${o.plate};backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 6px 24px rgba(15,27,36,.12);display:grid;place-items:center;cursor:pointer;color:${o.ink};transition:transform .2s}
.sa-btn:hover{transform:scale(1.08)}.sa-btn svg{width:18px;height:18px}
.sa-help{position:absolute;left:80px;bottom:72px;background:${o.plate};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:16px;padding:14px 16px;box-shadow:0 10px 40px rgba(15,27,36,.16);display:grid;grid-template-columns:auto auto;gap:7px 16px;font-size:13px;pointer-events:auto;opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s}
.sa-help.on{opacity:1;transform:none}.sa-help kbd{font:600 11px/1.2 'Inter',system-ui,sans-serif;background:rgba(15,27,36,.07);border-radius:6px;padding:3px 6px;justify-self:start}
.sa-prompt{position:absolute;left:50%;bottom:28px;transform:translate(-50%,12px);display:flex;white-space:nowrap;gap:4px;padding:5px;border-radius:999px;background:${o.plate};backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 8px 30px rgba(15,27,36,.14);opacity:0;transition:opacity .35s,transform .35s;pointer-events:none}
.sa-prompt.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}.sa-prompt span{padding:9px 14px}.sa-prompt button{border:0;border-radius:999px;padding:9px 16px;background:${o.ink};color:#fff;font:inherit;cursor:pointer}
.sa-load{position:absolute;inset:0;display:grid;place-items:center;background:#F4F0EB;transition:opacity .9s;pointer-events:auto;z-index:5}
.sa-load-in{display:flex;flex-direction:column;align-items:center;gap:14px;transition:opacity .6s,transform .8s cubic-bezier(.22,1,.36,1)}
.sa-load-in svg{width:44px;height:44px;margin-bottom:4px}
.sa-load-t{font:600 30px/1 'Inter',system-ui,sans-serif;letter-spacing:-.03em;color:${o.ink}}
.sa-load-s{font:500 14px/1.3 'Inter',system-ui,sans-serif;color:rgba(15,27,36,.55);letter-spacing:-.005em}
.sa-load-b{position:relative;width:200px;height:2px;margin-top:14px;background:rgba(15,27,36,.1);border-radius:2px;overflow:hidden}
.sa-load-b i{position:absolute;left:0;top:0;bottom:0;width:0;background:${o.accent};transition:width .35s}
.sa-load-n{font:600 12px/1 'Inter',system-ui,sans-serif;letter-spacing:.06em;color:rgba(15,27,36,.5);font-variant-numeric:tabular-nums}`
        ui.appendChild(css)
        const labelEls = islands.map((isl) => {
            const el = doc.createElement("button")
            el.type = "button"
            el.className = "sa-pill"
            el.innerHTML = `<i></i>${isl.title}<b>${isl.label}</b>`
            el.setAttribute("aria-label", "Fly to " + isl.title)
            el.addEventListener("pointerdown", (e) => e.stopPropagation())
            el.addEventListener("click", (e) => {
                e.stopPropagation()
                startSail(isl.key)
            })
            if (o.labels) ui.appendChild(el)
            return el
        })
        const icons = {
            keys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/></svg>',
            moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
            sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
            on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
            off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
        }
        let helpEl = null,
            timeBtn = null,
            soundBtn = null,
            ctrlEl = null
        if (o.controls) {
            const ctrl = doc.createElement("div")
            ctrl.className = "sa-ctrl"
            ui.appendChild(ctrl)
            ctrlEl = ctrl
            const mk = (svg, label, fn) => {
                const b = doc.createElement("button")
                b.className = "sa-btn"
                b.innerHTML = svg
                b.setAttribute("aria-label", label)
                b.title = label
                b.addEventListener("pointerdown", (e) => e.stopPropagation())
                b.addEventListener("click", (e) => {
                    e.stopPropagation()
                    fn()
                })
                ctrl.appendChild(b)
                return b
            }
            if (!coarse)
                mk(icons.keys, "Controls", () => helpEl.classList.toggle("on"))
            timeBtn = mk(
                state.night ? icons.sun : icons.moon,
                state.night ? "Switch to day" : "Switch to night",
                () => setNight(!state.night)
            )
            soundBtn = mk(icons.off, "Play sound", () => setSound(!soundOn))
            helpEl = doc.createElement("div")
            helpEl.className = "sa-help"
            helpEl.innerHTML = [
                ["Click", "Fly to a spot or an island"],
                ["W A S D", "Steer"],
                ["Shift", "Full throttle"],
                ["Enter", "Moor at the island"],
                ["Esc", "Cast off"],
                ["Drag", "Look around"],
                ["Scroll", "Zoom"],
            ]
                .map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`)
                .join("")
            ui.appendChild(helpEl)
        }
        const prompt = doc.createElement("div")
        prompt.className = "sa-prompt"
        prompt.innerHTML = `<span></span><button>Moor</button>`
        ui.appendChild(prompt)
        prompt.addEventListener("pointerdown", (e) => e.stopPropagation())
        const promptBtn = prompt.querySelector("button")
        promptBtn.tabIndex = -1
        promptBtn.addEventListener("click", () => {
            if (state.near) startSail(state.near)
        })
        let tip = null
        if (coarse && o.interactive && o.hint) {
            tip = doc.createElement("div")
            tip.className = "sa-tip"
            tip.textContent = "Tap an island to fly · or use the menu"
            ui.appendChild(tip)
        }
        const loader = doc.createElement("div")
        loader.className = "sa-load"
        const esc = (t) =>
            String(t || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
        const mark = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><clipPath id="saclip"><rect x="0" y="0" width="64" height="37"/></clipPath></defs><circle cx="32" cy="32" r="21" fill="${o.accent}" clip-path="url(#saclip)"/><rect x="6" y="40" width="52" height="5" rx="2.5" fill="${o.ink}"/><rect x="14" y="49" width="36" height="5" rx="2.5" fill="${o.ink}"/><rect x="23" y="58" width="18" height="5" rx="2.5" fill="${o.ink}"/></svg>`
        loader.innerHTML = `<div class="sa-load-in" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100">${o.loaderMark === false ? "" : mark}${o.loaderTitle ? `<div class="sa-load-t">${esc(o.loaderTitle)}</div>`: ""}${o.loaderSubtitle ?`<div class="sa-load-s">${esc(o.loaderSubtitle)}</div> `: ""}<div class="sa-load-b"><i></i></div><div class="sa-load-n">0</div></div>`
ui.appendChild(loader)
const loadBar = loader.querySelector(".sa-load-b i"),
loadNum = loader.querySelector(".sa-load-n"),
loadIn = loader.querySelector(".sa-load-in")


    // ---------- sound (WebAudio, generated)
    let audio = null,
        soundOn = false
    function makeAudio() {
        const AC = win.AudioContext || win.webkitAudioContext
        if (!AC) return null
        const ctx = new AC(),
            master = ctx.createGain()
        master.gain.value = 0
        master.connect(ctx.destination)
        const len = ctx.sampleRate * 4,
            buf = ctx.createBuffer(1, len, ctx.sampleRate),
            d = buf.getChannelData(0)
        let last = 0
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1
            last = (last + 0.02 * w) / 1.02
            d[i] = last * 3.2
        }
        const noise = ctx.createBufferSource()
        noise.buffer = buf
        noise.loop = true
        const wf = ctx.createBiquadFilter()
        wf.type = "bandpass"
        wf.frequency.value = 420
        wf.Q.value = 0.6
        const wg = ctx.createGain()
        wg.gain.value = 0.35
        noise.connect(wf).connect(wg).connect(master)
        noise.start()
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.07
        const lg = ctx.createGain()
        lg.gain.value = 260
        lfo.connect(lg).connect(wf.frequency)
        lfo.start()
        const pad = ctx.createGain()
        pad.gain.value = 0.05
        const pf = ctx.createBiquadFilter()
        pf.type = "lowpass"
        pf.frequency.value = 900
        pad.connect(pf).connect(master)
        ;[196, 246.94, 293.66, 392].forEach((f, i) => {
            const os = ctx.createOscillator()
            os.type = i % 2 ? "triangle" : "sine"
            os.frequency.value = f
            os.detune.value = (i - 1.5) * 4
            os.connect(pad)
            os.start()
        })
        const hum = ctx.createOscillator()
        hum.type = "sawtooth"
        hum.frequency.value = 52
        const hf = ctx.createBiquadFilter()
        hf.type = "lowpass"
        hf.frequency.value = 180
        const hg = ctx.createGain()
        hg.gain.value = 0
        hum.connect(hf).connect(hg).connect(master)
        hum.start()
        return { ctx, master, hg, nextChime: ctx.currentTime + 3 }
    }
    function chime() {
        if (!audio) return
        const { ctx, master } = audio,
            t = ctx.currentTime,
            notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]
        for (let k = 0; k < 3; k++) {
            const os = ctx.createOscillator(),
                g = ctx.createGain()
            os.type = "sine"
            os.frequency.value =
                notes[Math.floor(Math.random() * notes.length)]
            g.gain.setValueAtTime(0, t + k * 0.18)
            g.gain.linearRampToValueAtTime(0.05, t + k * 0.18 + 0.01)
            g.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.18 + 2.4)
            os.connect(g).connect(master)
            os.start(t + k * 0.18)
            os.stop(t + k * 0.18 + 2.5)
        }
    }
    function setSound(on) {
        soundOn = !!on
        if (soundOn && !audio) audio = makeAudio()
        if (audio) {
            if (audio.ctx.state === "suspended") audio.ctx.resume()
            audio.master.gain.setTargetAtTime(
                soundOn ? 0.8 : 0,
                audio.ctx.currentTime,
                0.4
            )
        }
        try {
            win.localStorage.setItem("skyarch-sound", soundOn ? "1" : "0")
        } catch (e) {}
        if (soundBtn) {
            soundBtn.innerHTML = soundOn ? icons.on : icons.off
            soundBtn.setAttribute(
                "aria-label",
                soundOn ? "Mute sound" : "Play sound"
            )
            soundBtn.title = soundBtn.getAttribute("aria-label")
        }
        emit("sound", null, { on: soundOn })
    }
    function setNight(n) {
        state.night = n ? 1 : 0
        if (timeBtn) {
            timeBtn.innerHTML = n ? icons.sun : icons.moon
            timeBtn.setAttribute(
                "aria-label",
                n ? "Switch to day" : "Switch to night"
            )
            timeBtn.title = timeBtn.getAttribute("aria-label")
        }
        emit("time", null, { night: !!n })
    }

    // ---------- interaction
    const ray = new THREE.Raycaster(),
        ndc = new THREE.Vector2(),
        plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -H)
    const pointers = new Map()
    let dragged = 0,
        pinch0 = 0,
        dist0 = 0
    function start() {
        if (!state.started) {
            state.started = true
            emit("start")
            if (tip) tip.style.opacity = "0"
        }
    }
    const ease = (t) =>
        t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 // gentle quad in-out: no sudden dash mid-flight
    function startSail(key) {
        const isl = islands.find((i) => i.key === key)
        if (!isl) return
        start()
        if (xfer && xfer.key === key) {
            xfer.t = xfer.T
            return
        } // second click: land now
        if (state.docked === key) return
        if (state.docked) {
            const prev = state.docked
            state.docked = null
            emit("leave", prev)
        }
        auto = null
        const dist = Math.hypot(isl.dockPos.x - sp.x, isl.dockPos.z - sp.z)
        const T = reduced ? 0.35 : clamp(dist / 15, 5.5, 8.5)
        const f = Math.min(dist * 0.35, 34)
        xfer = {
            key,
            t: 0,
            T,
            lift: reduced ? 0 : Math.min(9, dist * 0.06),
            p0: new THREE.Vector2(sp.x, sp.z),
            p1: new THREE.Vector2(
                sp.x - Math.sin(sp.yaw) * f,
                sp.z - Math.cos(sp.yaw) * f
            ),
            p2: new THREE.Vector2(
                isl.dockPos.x + isl.dockDir.x * 30,
                isl.dockPos.z + isl.dockDir.y * 30
            ),
            p3: new THREE.Vector2(isl.dockPos.x, isl.dockPos.z),
        }
        state.docked = key
        state.mode = "docked"
        emit("sail", key)
    }
    function flyTo(x, z) {
        start()
        if (state.docked) leaveDock(true)
        const r = Math.hypot(x, z + 40)
        if (r > 230) {
            const k = 230 / r
            x *= k
            z = (z + 40) * k - 40
        }
        for (const isl of allIslands) {
            const dx = x - isl.x,
                dz = z - isl.z,
                d = Math.hypot(dx, dz),
                min = isl.r + 6
            if (d < min) {
                x = isl.x + (dx / (d || 1)) * min
                z = isl.z + (dz / (d || 1)) * min
            }
        }
        auto = { x, z, key: null, dock: false }
        marker.position.set(x, H - 3.5, z)
        marker.material.opacity = 0.9
        marker.scale.setScalar(0.4)
    }
    function leaveDock(silent = false) {
        const key = state.docked
        if (!key) return
        const isl = islands.find((i) => i.key === key)
        state.docked = null
        state.mode = "free"
        xfer = null
        // cast off: drift gently away from the pier without turning (no spin in place)
        auto = null
        if (isl && !silent)
            backOff = {
                t: 0,
                T: reduced ? 0.01 : 2.6,
                x0: sp.x,
                z0: sp.z,
                x1: sp.x + isl.dockDir.x * 9,
                z1: sp.z + isl.dockDir.y * 9,
            }
        emit("leave", key)
    }
    const onDown = (e) => {
        if (!o.interactive) return
        root.focus({ preventScroll: true })
        pointers.set(e.pointerId, {
            x: e.clientX,
            y: e.clientY,
            x0: e.clientX,
            y0: e.clientY,
        })
        dragged = 0
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()]
            pinch0 = Math.hypot(a.x - b.x, a.y - b.y)
            dist0 = cam.distT
        }
        root.setPointerCapture && root.setPointerCapture(e.pointerId)
        if (audio && soundOn && audio.ctx.state === "suspended")
            audio.ctx.resume()
    }
    const onMove = (e) => {
        const p = pointers.get(e.pointerId)
        if (!p) return
        const dx = e.clientX - p.x,
            dy = e.clientY - p.y
        p.x = e.clientX
        p.y = e.clientY
        dragged += Math.abs(dx) + Math.abs(dy)
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()]
            const d = Math.hypot(a.x - b.x, a.y - b.y)
            cam.distT = clamp(dist0 * (pinch0 / (d || 1)), 18, 80)
            return
        }
        if (dragged > 6) {
            cam.yawOffT -= dx * 0.005
            cam.pitchT = clamp(cam.pitchT + dy * 0.003, 0.08, 0.95)
            start()
        }
    }
    const onUp = (e) => {
        const p = pointers.get(e.pointerId)
        pointers.delete(e.pointerId)
        if (!p || dragged > 8 || pointers.size > 0) return
        const r = renderer.domElement.getBoundingClientRect()
        ndc.set(
            ((e.clientX - r.left) / r.width) * 2 - 1,
            -((e.clientY - r.top) / r.height) * 2 + 1
        )
        ray.setFromCamera(ndc, camera)
        const hits = ray.intersectObjects(
            islands.map((i) => i.group),
            true
        )
        if (hits.length) {
            let n = hits[0].object
            while (n && !n.userData.isl) n = n.parent
            if (n && n.userData.isl) {
                startSail(n.userData.isl.key)
                return
            }
        }
        const pt = new THREE.Vector3()
        if (ray.ray.intersectPlane(plane, pt)) flyTo(pt.x, pt.z)
    }
    const onWheel = (e) => {
        if (!o.interactive) return
        e.preventDefault()
        cam.distT = clamp(
            cam.distT * (1 + Math.sign(e.deltaY) * 0.08),
            18,
            80
        )
    }
    const typing = (t) =>
        !!t &&
        (t.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""))
    const onKey = (e) => {
        if (
            !o.interactive ||
            e.metaKey ||
            e.ctrlKey ||
            e.altKey ||
            typing(e.target)
        )
            return
        const k = e.code,
            t = e.target
        if (k === "Escape") {
            if (state.docked) leaveDock()
            else auto = null
            helpEl && helpEl.classList.remove("on")
            return
        }
        const free =
            !t || t === root || t === doc.body || t === doc.documentElement
        if (!free) return // links, buttons and panels keep their own keys
        if (
            [
                "KeyW",
                "KeyA",
                "KeyS",
                "KeyD",
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                "ShiftLeft",
                "ShiftRight",
            ].includes(k)
        ) {
            if (state.docked && t !== root) return // reading a panel: arrows scroll the page, not the ship
            keys.add(k)
            start()
            if (k.startsWith("Key") || k.startsWith("Arrow")) {
                auto = null
                if (state.docked) leaveDock()
                e.preventDefault()
            }
        }
        if (k === "Enter" && state.near && !state.docked)
            startSail(state.near)
    }
    const onKeyUp = (e) => keys.delete(e.code)
    root.addEventListener("pointerdown", onDown)
    root.addEventListener("pointermove", onMove)
    root.addEventListener("pointerup", onUp)
    root.addEventListener("pointercancel", (e) =>
        pointers.delete(e.pointerId)
    )
    root.addEventListener("wheel", onWheel, { passive: false })
    win.addEventListener("keydown", onKey)
    win.addEventListener("keyup", onKeyUp)
    const onCmd = (e) => {
        const d = e.detail || {}
        if (d.type === "sail") startSail(d.key)
        else if (d.type === "undock") leaveDock()
        else if (d.type === "night") setNight(d.on)
        else if (d.type === "sound") setSound(d.on)
    }
    win.addEventListener(EVT + ":command", onCmd)

    // ---------- resize / visibility
    let W = 1,
        Hh = 1
    const resize = () => {
        const r = container.getBoundingClientRect()
        W = Math.max(1, r.width)
        Hh = Math.max(1, r.height)
        renderer.setSize(W, Hh, false)
        camera.aspect = W / Hh
        camera.fov = clamp(
            (2 *
                Math.atan(Math.tan((26 * Math.PI) / 180) / camera.aspect) *
                180) /
                Math.PI,
            48,
            75
        )
        camera.updateProjectionMatrix()
    }
    resize()
    const ro =
        typeof win.ResizeObserver !== "undefined"
            ? new ResizeObserver(resize)
            : null
    if (ro) ro.observe(container)
    let visible = true
    const io =
        typeof win.IntersectionObserver !== "undefined"
            ? new IntersectionObserver((en) => {
                  visible = en[0].isIntersecting
              })
            : null
    if (io) io.observe(container)

    // ---------- palette blend
    const tmpC = new THREE.Color()
    function applyPalette(t) {
        const a = PAL.day,
            b = PAL.night
        const mix = (k) => tmpC.copy(a[k]).lerp(b[k], t)
        skyU.uZenith.value.copy(mix("zenith"))
        skyU.uHorizon.value.copy(mix("horizon"))
        skyU.uSun.value.copy(mix("sun"))
        skyU.uStars.value = t
        scene.fog.color.copy(mix("fog"))
        seaU.uFog.value.copy(scene.fog.color)
        seaU.uLit.value.copy(mix("cloudLit"))
        seaU.uShade.value.copy(mix("cloudShade"))
        hemi.color.copy(mix("hemiSky"))
        hemi.groundColor.copy(mix("hemiGround"))
        hemi.intensity = lerp(a.hemiI, b.hemiI, t)
        sun.color.copy(mix("sun"))
        sun.intensity = lerp(a.sunI, b.sunI, t)
        puffMat.color.copy(tmpC.copy(C("#fff3e4")).lerp(C("#7d8cc8"), t))
        puffMat.emissive.copy(tmpC.copy(C("#9d8fc4")).lerp(C("#1f2a55"), t))
        renderer.toneMappingExposure = lerp(a.exposure, b.exposure, t)
        mats.window.emissiveIntensity = lerp(0.08, 2.2, t)
        mats.lamp.emissiveIntensity = lerp(0.2, 3, t)
        glowSprites.forEach((s) => {
            s.material.opacity = t * 0.9
            s.visible = t > 0.01
        })
        islands.forEach((i) => {
            const u = i.group.userData
            if (u.beamMat) {
                u.beamMat.opacity = t * 0.16
                u.beams.visible = t > 0.01
            }
        })
    }

    // ---------- loop
    let last = performance.now(),
        time = 0,
        frames = 0,
        ftAcc = 0,
        tier = 2,
        loaded = 0,
        raf = 0,
        lastPal = -1,
        puffTick = 0,
        idleFor = 0,
        skipOdd = false
    const fwd = new THREE.Vector3(),
        tmpV = new THREE.Vector3(),
        tmpV2 = new THREE.Vector3()
    function updateShip(dt) {
        const up = keys.has("KeyW") || keys.has("ArrowUp"),
            dn = keys.has("KeyS") || keys.has("ArrowDown")
        const lf = keys.has("KeyA") || keys.has("ArrowLeft"),
            rt = keys.has("KeyD") || keys.has("ArrowRight")
        const boost = keys.has("ShiftLeft") || keys.has("ShiftRight")
        let thr = 0,
            steer = 0
        const maxV = boost ? 12 : 7
        if (backOff && !xfer && !state.docked) {
            backOff.t = Math.min(backOff.T, backOff.t + dt)
            const u = ease(backOff.t / backOff.T)
            sp.x = lerp(backOff.x0, backOff.x1, u)
            sp.z = lerp(backOff.z0, backOff.z1, u)
            sp.speed = 0
            sp.yawRate = damp(sp.yawRate, 0, 4, dt)
            if (backOff.t >= backOff.T || auto || keys.size) backOff = null
        } else if (xfer) {
            xfer.t = Math.min(xfer.T, xfer.t + dt)
            const u = ease(xfer.t / xfer.T),
                v = 1 - u,
                { p0, p1, p2, p3 } = xfer
            xfer.u = u
            const nx =
                v * v * v * p0.x +
                3 * v * v * u * p1.x +
                3 * v * u * u * p2.x +
                u * u * u * p3.x
            const nz =
                v * v * v * p0.y +
                3 * v * v * u * p1.y +
                3 * v * u * u * p2.y +
                u * u * u * p3.y
            const isl = islands.find((i) => i.key === xfer.key)
            const mv = Math.hypot(nx - sp.x, nz - sp.z)
            const want =
                mv > 0.01 ? Math.atan2(-(nx - sp.x), -(nz - sp.z)) : sp.yaw
            const yawT = u > 0.85 ? isl.dockYaw : want
            const prevYaw = sp.yaw
            sp.yaw =
                sp.yaw + wrapPI(yawT - sp.yaw) * (1 - Math.exp(-3.5 * dt))
            sp.yawRate = damp(
                sp.yawRate,
                wrapPI(sp.yaw - prevYaw) / Math.max(dt, 1e-3),
                4,
                dt
            )
            sp.speed = mv / Math.max(dt, 1e-3)
            sp.x = nx
            sp.z = nz
            sp.lift = Math.sin(Math.PI * u) * xfer.lift
            if (xfer.t >= xfer.T) {
                const k = xfer.key
                xfer = null
                sp.speed = 0
                sp.lift = 0
                if (state.docked === k) emit("arrive", k)
            } // panel opens once moored
        } else if (state.docked) {
            const isl = islands.find((i) => i.key === state.docked)
            sp.x = damp(sp.x, isl.dockPos.x, 2, dt)
            sp.z = damp(sp.z, isl.dockPos.z, 2, dt)
            sp.yaw =
                sp.yaw +
                wrapPI(isl.dockYaw - sp.yaw) * (1 - Math.exp(-2 * dt))
            sp.speed = damp(sp.speed, 0, 3, dt)
        } else if (auto) {
            const dx = auto.x - sp.x,
                dz = auto.z - sp.z,
                d = Math.hypot(dx, dz)
            const want = Math.atan2(-dx, -dz)
            const err = wrapPI(want - sp.yaw)
            steer = clamp(err * 2.2, -1, 1)
            const vT = auto.dock
                ? clamp(d * 0.35, 1, 7.5)
                : clamp(d * 0.3, 0, auto.gentle ? 4.5 : 7.5)
            sp.speed = damp(
                sp.speed,
                vT * (1 - Math.min(1, Math.abs(err) / 2.2) * 0.6),
                1.6,
                dt
            )
            if (d < (auto.dock ? 3.2 : 2.5)) {
                if (auto.dock) {
                    state.docked = auto.key
                    state.mode = "docked"
                    emit("arrive", auto.key)
                }
                auto = null
            }
        } else {
            thr = (up ? 1 : 0) - (dn ? 0.6 : 0)
            steer = (lf ? 1 : 0) - (rt ? 1 : 0)
            const vT = thr > 0 ? maxV : thr < 0 ? -4 : 0
            sp.speed = damp(sp.speed, vT, thr ? 0.9 : 0.6, dt)
        }
        if (!state.docked && !xfer && !backOff) {
            const turn = auto ? steer * 0.9 : steer * 0.85
            sp.yawRate = damp(sp.yawRate, turn, 3, dt)
            sp.yaw = wrapPI(
                sp.yaw +
                    sp.yawRate *
                        dt *
                        (0.4 + Math.min(1, Math.abs(sp.speed) / 8) * 0.6)
            )
            sp.x += -Math.sin(sp.yaw) * sp.speed * dt
            sp.z += -Math.cos(sp.yaw) * sp.speed * dt
        }
        // collisions
        for (const isl of allIslands) {
            const dx = sp.x - isl.x,
                dz = sp.z - isl.z,
                d = Math.hypot(dx, dz),
                min = isl.r * 0.95 + 3.2
            if (d < min && !state.docked && !xfer && !backOff) {
                sp.x = isl.x + (dx / d) * min
                sp.z = isl.z + (dz / d) * min
                sp.speed *= 0.96
            }
        }
        const bx = sp.x,
            bz = sp.z + 40,
            br2 = Math.hypot(bx, bz)
        if (br2 > 250) {
            sp.x = (bx / br2) * 250
            sp.z = (bz / br2) * 250 - 40
            sp.speed *= 0.95
        }
        sp.roll = damp(
            sp.roll,
            -sp.yawRate * 0.22 * Math.min(1, Math.abs(sp.speed) / 6),
            3,
            dt
        )
        sp.pitch = damp(sp.pitch, clamp(-thr * 0.05, -0.05, 0.05), 2, dt)
        const bob = reduced ? 0 : Math.sin(time * 0.9) * 0.35
        ship.position.set(sp.x, H + bob + (sp.lift || 0), sp.z)
        ship.rotation.set(
            sp.pitch + (reduced ? 0 : Math.sin(time * 0.7) * 0.015),
            sp.yaw,
            sp.roll,
            "YXZ"
        )
        prop.rotation.z += dt * (2 + Math.abs(sp.speed) * 1.6)
        if (audio)
            audio.hg.gain.setTargetAtTime(
                soundOn ? clamp(Math.abs(sp.speed) / 22, 0, 1) * 0.12 : 0,
                audio.ctx.currentTime,
                0.3
            )
        // near detection
        let near = null
        if (!state.docked)
            for (const isl of islands) {
                if (
                    Math.hypot(sp.x - isl.dockPos.x, sp.z - isl.dockPos.z) <
                    26
                )
                    near = isl.key
            }
        if (near !== state.near) {
            state.near = near
            if (near) emit("near", near)
        }
        const showPrompt = !!near && !state.docked && !(auto && auto.dock)
        prompt.classList.toggle("on", showPrompt)
        promptBtn.tabIndex = showPrompt ? 0 : -1
        if (near) {
            const isl = islands.find((i) => i.key === near)
            prompt.querySelector("span").textContent =
                isl.title + " · " + isl.label
        }
    }
    function updateCamera(dt) {
        const docked =
            state.docked && islands.find((i) => i.key === state.docked)
        cam.dist = damp(cam.dist, cam.distT, 4, dt)
        cam.yawOff = damp(cam.yawOff, cam.yawOffT, 4, dt)
        cam.pitch = damp(cam.pitch, cam.pitchT, 4, dt)
        if (!pointers.size && Math.abs(sp.speed) > 3)
            cam.yawOffT = damp(cam.yawOffT, 0.18, 0.5, dt)
        let target, eye
        if (docked) {
            // frame island on the left, ship in front — leave room for a panel on the right
            const c = new THREE.Vector3(docked.x, docked.top + 2, docked.z)
            const outD = new THREE.Vector3(
                docked.dockDir.x,
                0,
                docked.dockDir.y
            )
            const side = new THREE.Vector3(-outD.z, 0, outD.x)
            const mid = c.clone().lerp(docked.dockPos, 0.4)
            const ang = 0.95
            const dirC = outD
                .clone()
                .multiplyScalar(Math.cos(ang))
                .addScaledVector(side, -Math.sin(ang))
            eye = mid
                .clone()
                .addScaledVector(dirC, 40 + docked.r * 1.9)
                .add(new THREE.Vector3(0, 7 + docked.r * 0.3, 0))
            const toEye = eye.clone().sub(mid).setY(0).normalize()
            const right = new THREE.Vector3(-toEye.z, 0, toEye.x)
            target = mid.clone().add(new THREE.Vector3(0, -1, 0))
            if (xfer) {
                // during the transfer: a high chase shot that hands over to the docked framing
                const a = sp.yaw + 0.25,
                    ch = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)),
                    dd = cam.dist + 10,
                    pt = 0.42
                const cEye = new THREE.Vector3(
                    sp.x,
                    H + (sp.lift || 0),
                    sp.z
                )
                    .addScaledVector(ch, -dd * Math.cos(pt))
                    .add(new THREE.Vector3(0, dd * Math.sin(pt) + 4, 0))
                const cTar = new THREE.Vector3(
                    sp.x,
                    H + 2 + (sp.lift || 0),
                    sp.z
                ).addScaledVector(ch, 20)
                const w = clamp(((xfer.u || 0) - 0.45) / 0.55, 0, 1),
                    ws = w * w * (3 - 2 * w)
                eye = cEye.lerp(eye, ws)
                target = cTar.lerp(target, ws)
            }
        } else {
            const a = sp.yaw + cam.yawOff
            fwd.set(-Math.sin(a), 0, -Math.cos(a))
            eye = tmpV
                .set(sp.x, H, sp.z)
                .addScaledVector(fwd, -cam.dist * Math.cos(cam.pitch))
                .add(tmpV2.set(0, cam.dist * Math.sin(cam.pitch) + 3, 0))
            target = new THREE.Vector3(sp.x, H + 3.5, sp.z).addScaledVector(
                fwd,
                16
            )
        }
        const k = docked ? (xfer ? 2.0 : 1.2) : 2.4
        if (cam.intro > 0) {
            cam.intro = Math.max(0, cam.intro - dt * 0.4)
            const e = 1 - Math.pow(1 - (1 - cam.intro), 3)
            eye = eye
                .clone()
                .add(new THREE.Vector3(0, 60 * (1 - e), 70 * (1 - e)))
        }
        if (cam.snap) {
            cam.snap = false
            cam.pos.copy(eye)
            cam.look.copy(target)
        }
        // keep the island clear of the panel (desktop: right panel, phone: bottom sheet)
        const wantX = docked && W >= 810 ? Math.min(226, W * 0.18) : 0,
            wantY = docked && W < 810 ? Hh * 0.28 : 0
        cam.vx = damp(cam.vx, wantX, 2.6, dt)
        cam.vy = damp(cam.vy, wantY, 2.6, dt)
        if (Math.abs(cam.vx) > 0.5 || Math.abs(cam.vy) > 0.5)
            camera.setViewOffset(W, Hh, cam.vx, cam.vy, W, Hh)
        else if (camera.view) camera.clearViewOffset()
        cam.pos.x = damp(cam.pos.x, eye.x, k, dt)
        cam.pos.y = damp(cam.pos.y, eye.y, k, dt)
        cam.pos.z = damp(cam.pos.z, eye.z, k, dt)
        cam.look.x = damp(cam.look.x, target.x, k, dt)
        cam.look.y = damp(cam.look.y, target.y, k, dt)
        cam.look.z = damp(cam.look.z, target.z, k, dt)
        camera.position.copy(cam.pos)
        camera.lookAt(cam.look)
        seaU.uCam.value.copy(camera.position)
        sky.position.copy(camera.position)
        // keep sun shadow around the ship
        const sd = skyU.uSunDir.value
        sun.position.set(
            sp.x + sd.x * 120,
            H + sd.y * 120 + 60,
            sp.z + sd.z * 120
        )
        sun.target.position.set(sp.x, H - 6, sp.z)
    }
    const proj = new THREE.Vector3()
    function updateLabels() {
        islands.forEach((isl, i) => {
            const el = labelEls[i]
            const top =
                isl.kind === "beacon"
                    ? 20
                    : isl.kind === "library"
                      ? 13
                      : 10
            proj.set(isl.x, isl.top + top, isl.z).project(camera)
            const behind = proj.z > 1
            let x = ((proj.x + 1) / 2) * W,
                y = ((1 - proj.y) / 2) * Hh
            if (behind) {
                x = W - x
                y = Hh - 40
            }
            if (!el._hw || el._hw < 20)
                el._hw = (el.offsetWidth || 120) / 2 + 10
            const edgeX = el._hw,
                off =
                    behind ||
                    x < edgeX ||
                    x > W - edgeX ||
                    y < 96 ||
                    y > Hh - 40
            let arrow = ""
            if (off) {
                if (x < edgeX) arrow = "←"
                else if (x > W - edgeX) arrow = "→"
                else if (y < 96) arrow = "↑"
                else arrow = "↓"
                x = clamp(x, edgeX, W - edgeX)
                y = clamp(y, 108, Hh - 40)
            }
            const vis = state.docked !== isl.key && !(off && state.docked)
            const dd = camera.position.distanceTo(
                tmpV.set(isl.x, isl.top, isl.z)
            )
            const op = vis
                ? off
                    ? 0.8
                    : clamp(1.6 - dd / 260, 0.35, 1)
                : 0
            if (el._op !== op) {
                el._op = op
                el.style.opacity = String(op)
                el.style.pointerEvents = vis ? "auto" : "none"
                el.tabIndex = vis ? 0 : -1
            }
            if (el._ar !== arrow) {
                el._ar = arrow
                if (arrow) el.setAttribute("data-arrow", arrow)
                else el.removeAttribute("data-arrow")
            }
            el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`
        })
    }
    function frame(now) {
        raf = win.requestAnimationFrame(frame)
        let dt = clamp((now - last) / 1000, 0, 0.05)
        last = now
        if (!visible || doc.hidden) return
        time += dt
        seaU.uTime.value = time
        skyU.uTime.value = time
        state.nightT = damp(state.nightT, state.night, 2.2, dt)
        if (Math.abs(state.nightT - lastPal) > 1e-4) {
            applyPalette(state.nightT)
            lastPal = state.nightT
        }
        updateShip(dt)
        updateCamera(dt)
        if (++puffTick % 3 === 0) updatePuffs(time)
        birds.forEach((b) => {
            const a = b.ph + time * b.sp
            b.m.position.set(
                b.cx + Math.cos(a) * b.r,
                b.y + Math.sin(time * 0.6 + b.ph) * 1.5,
                b.cz + Math.sin(a) * b.r
            )
            b.m.rotation.set(
                0,
                -a + (b.sp > 0 ? 0 : Math.PI),
                Math.sin(time * 9 + b.ph) * 0.5
            )
            b.m.scale.y = 0.6 + Math.abs(Math.sin(time * 9 + b.ph)) * 0.6
        })
        islands.forEach((isl) => {
            const u = isl.group.userData
            if (u.beams) u.beams.rotation.y += dt * 0.6
            if (u.lamp) {
                const p = 0.5 + 0.5 * Math.sin(time * 3)
                u.lamp.material.emissiveIntensity = 0.8 + p * 2.4
            }
            if (u.lampGlow) {
                u.lampGlow.material.opacity = 0.35 + state.nightT * 0.6
                u.lampGlow.visible = true
            }
        })
        if (studio) {
            const from = studio.group.userData.smokeFrom
            smoke.forEach((s) => {
                s.visible = !state.docked || state.docked === "animals"
                s.userData.t = (s.userData.t + dt * 0.12) % 1
                const t = s.userData.t
                const p = from.localToWorld(tmpV.copy(from.userData.smoke))
                s.position.set(p.x + t * 3, p.y + t * 7, p.z - t * 1.5)
                s.scale.setScalar(1 + t * 4)
                s.material.opacity =
                    (1 - t) * 0.35 * (1 - state.nightT * 0.5)
            })
        }
        marker.material.opacity = damp(
            marker.material.opacity,
            auto && !auto.dock ? 0.85 : 0,
            3,
            dt
        )
        marker.visible = marker.material.opacity > 0.01
        marker.scale.setScalar(damp(marker.scale.x, 1, 4, dt))
        marker.rotation.z += dt
        if (audio && soundOn && audio.ctx.currentTime > audio.nextChime) {
            chime()
            audio.nextChime = audio.ctx.currentTime + 7 + Math.random() * 9
        }
        updateLabels()
        if (ctrlEl) {
            const hide = !!state.docked && W < 810
            if (ctrlEl._h !== hide) {
                ctrlEl._h = hide
                ctrlEl.style.opacity = hide ? "0" : "1"
                ctrlEl.style.pointerEvents = hide ? "none" : "auto"
            }
        }
        // docked and idle: draw at 30 fps
        idleFor =
            state.docked &&
            !xfer &&
            !pointers.size &&
            !keys.size &&
            loaded >= 1
                ? idleFor + dt
                : 0
        skipOdd = idleFor > 1.5 ? !skipOdd : false
        if (!skipOdd) renderer.render(scene, camera)
        // loader + quality
        if (loaded < 1) {
            loaded = Math.min(1, loaded + dt * (seen ? 4 : 0.9))
            const pct = Math.round(loaded * 100)
            loadBar.style.width = pct + "%"
            loadNum.textContent = String(pct)
            loadIn.setAttribute("aria-valuenow", String(pct))
            if (loaded >= 1) {
                loadIn.style.opacity = "0"
                loadIn.style.transform = "translateY(-8px)"
                setTimeout(() => {
                    loader.style.opacity = "0"
                    loader.style.pointerEvents = "none"
                }, 250)
                setTimeout(() => loader.remove(), 1300)
                emit("loaded")
                try {
                    win.sessionStorage.setItem("skyarch-seen", "1")
                } catch (e) {}
                if (pendingDock) {
                    const k = pendingDock
                    pendingDock = null
                    emit("arrive", k)
                }
            }
        }
        frames++
        ftAcc += dt
        if (frames === 90) {
            const avg = ftAcc / frames
            if (avg > 1 / 40 && tier > 0) {
                tier--
                dpr = Math.max(0.75, dpr * 0.8)
                renderer.setPixelRatio(dpr)
                resize()
                if (tier === 0) {
                    renderer.shadowMap.enabled = false
                    scene.traverse((m) => {
                        if (m.material) m.material.needsUpdate = true
                    })
                }
                emit("quality", null, { tier, dpr })
            }
            frames = 0
            ftAcc = 0
        }
    }
    applyPalette(state.nightT)
    raf = win.requestAnimationFrame(frame)

    // URL hash: #work opens the Work island directly; arriving/leaving keeps the hash in sync
    let pendingDock = null
    const keyFromHash = () => {
        const h = (win.location.hash || "").replace("#", "")
        return islands.some((i) => i.key === h) ? h : null
    }
    const h0 = o.interactive && keyFromHash()
    if (h0) {
        const isl = islands.find((i) => i.key === h0)
        sp.x = isl.dockPos.x
        sp.z = isl.dockPos.z
        sp.yaw = isl.dockYaw
        state.docked = h0
        state.mode = "docked"
        state.started = true
        cam.intro = 0
        cam.snap = true
        const g = (win.__skyarch = win.__skyarch || {})
        g.active = true
        g.started = true
        g.docked = h0
        emit("start")
        if (tip) tip.style.opacity = "0"
        pendingDock = h0
    }
    const onArriveHash = (e) => {
        const d = e.detail || {}
        if (!o.interactive) return
        try {
            if (d.type === "arrive" && win.location.hash !== "#" + d.key)
                win.history.pushState(win.history.state, "", "#" + d.key)
            if (d.type === "leave")
                setTimeout(() => {
                    if (!state.docked && win.location.hash)
                        win.history.replaceState(
                            win.history.state,
                            "",
                            win.location.pathname + win.location.search
                        )
                }, 0)
        } catch (err) {}
    }
    win.addEventListener(EVT, onArriveHash)
    const onPop = () => {
        const k = keyFromHash()
        if (k) startSail(k)
        else if (state.docked) leaveDock()
    }
    win.addEventListener("popstate", onPop)

    // restore sound pref + go-to request
    try {
        if (win.localStorage.getItem("skyarch-sound") === "1" && o.sound)
            setSound(true)
    } catch (e) {}
    try {
        const go = win.sessionStorage.getItem("skyarch-go")
        if (go) {
            win.sessionStorage.removeItem("skyarch-go")
            setTimeout(() => startSail(go), 1200)
        }
    } catch (e) {}

    return {
        command: (d) => onCmd({ detail: d }),
        info: () => ({
            yaw: sp.yaw,
            x: sp.x,
            z: sp.z,
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            dpr,
            tier,
        }),
        destroy() {
            state.destroyed = true
            win.cancelAnimationFrame(raf)
            ro && ro.disconnect()
            io && io.disconnect()
            win.removeEventListener("keydown", onKey)
            win.removeEventListener("keyup", onKeyUp)
            win.removeEventListener(EVT + ":command", onCmd)
            win.removeEventListener(EVT, onArriveHash)
            win.removeEventListener("popstate", onPop)
            if (audio) audio.ctx.close()
            scene.traverse((m) => {
                if (m.geometry) m.geometry.dispose()
                if (m.material)
                    (Array.isArray(m.material)
                        ? m.material
                        : [m.material]
                    ).forEach((x) => {
                        x.map && x.map.dispose()
                        x.dispose()
                    })
            })
            renderer.dispose()
            root.remove()
            const g = win.__skyarch
            if (g) {
                g.active = false
                g.docked = null
            }
        },
    }
}

export { createSkyArchipelago };
