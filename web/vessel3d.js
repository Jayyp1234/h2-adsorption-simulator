/* Interactive 3D vessel view.
 *
 * Geometry is driven by the real P&ID dimensions (PID-ZHS-FAB-002), not by eye:
 * ID 50 mm, length 250 mm, 30 mm dead space at each end, retainer screens bounding
 * the bed, dry-ice/acetone bath to the marked level. Scene units are centimetres.
 *
 * The bed is an InstancedMesh of a few thousand particles rather than a solid cylinder,
 * so the cutaway reads as a packed bed. H2 is a second InstancedMesh whose particles
 * travel the inlet path and then adsorb onto bed sites at a rate driven by the live
 * simulation state, so the animation reflects the model rather than decorating it.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const C = {
  steel:      0xb9c2cc,
  steelDark:  0x7d8894,
  cap:        0x98a3ae,
  zeolite:    0xd9b26a,
  carbon:     0x3a3a3f,
  screen:     0x8c949e,
  acetone:    0x9fd4e8,
  glass:      0xdfe9f2,
  dryIce:     0xf2f7fb,
  hydrogen:   0x4da3ff,
  adsorbed:   0x2f6fd0,
  tape:       0xc0392b,
  brass:      0xc9a227,
};

export function createVesselView(container, cfg = {}, hooks = {}) {
  const dims = Object.assign({
    innerDiaMm: 50, lengthMm: 250, wallMm: 4, deadSpaceMm: 30,
    bathFill: 0.62, bedColor: C.zeolite, showCarbon: true, carbonFraction: 0.15,
    heatingTape: true,
  }, cfg.dims || {});

  const R  = dims.innerDiaMm / 20;             // inner radius, cm
  const WT = dims.wallMm / 10;
  const RO = R + WT;                            // outer radius
  const L  = dims.lengthMm / 10;                // cm
  const DS = dims.deadSpaceMm / 10;
  const bedH = L - 2 * DS;
  const bedY0 = -L / 2 + DS;

  /* ------------------------------------------------------------ renderer */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block;border-radius:8px";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 500);
  camera.position.set(40, 15, 47);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 14;
  controls.maxDistance = 130;
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.target.set(0, -1, 0);

  /* ------------------------------------------------- lighting + environment */
  // Procedural studio environment so the steel has something believable to reflect,
  // without shipping an HDR file.
  const envCanvas = document.createElement("canvas");
  envCanvas.width = envCanvas.height = 256;
  const ex = envCanvas.getContext("2d");
  const grad = ex.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "#ffffff");
  grad.addColorStop(0.45, "#c8d4e0");
  grad.addColorStop(0.55, "#8fa0b2");
  grad.addColorStop(1.0, "#3d4855");
  ex.fillStyle = grad; ex.fillRect(0, 0, 256, 256);
  ex.fillStyle = "rgba(255,255,255,0.95)";
  ex.fillRect(30, 20, 70, 46); ex.fillRect(150, 40, 60, 30);
  const envTex = new THREE.CanvasTexture(envCanvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  envTex.dispose(); pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d99a6, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(26, 34, 22);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 140;
  key.shadow.camera.left = -34; key.shadow.camera.right = 34;
  key.shadow.camera.top = 40; key.shadow.camera.bottom = -34;
  key.shadow.bias = -0.0012;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdce8f5, 0.5);
  fill.position.set(-24, 12, -18); scene.add(fill);

  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(150, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xeef3f8, side: THREE.BackSide, fog: false }));
  scene.add(backdrop);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.19 }));
  ground.position.y = -L / 2 - 9.5;
  ground.receiveShadow = true;
  scene.add(ground);

  /* --------------------------------------------------------------- layers */
  const layers = {};
  const mk = (name) => { const g = new THREE.Group(); g.name = name; layers[name] = g; scene.add(g); return g; };
  const gShell = mk("shell"), gCaps = mk("caps"), gBed = mk("bed"),
        gScreens = mk("screens"), gBath = mk("bath"), gPiping = mk("piping"),
        gTape = mk("tape"), gFlow = mk("flow");

  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const steelMat = (color, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({
    color, metalness: 0.92, roughness: 0.29, envMapIntensity: 1.1,
  }, extra));

  /* ---------------------------------------------------------------- shell */
  const shellMat = steelMat(C.steel, { side: THREE.DoubleSide, clippingPlanes: [] });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(RO, RO, L, 96, 1, true), shellMat);
  shell.castShadow = shell.receiveShadow = true;
  gShell.add(shell);
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 96, 1, true),
    steelMat(C.steelDark, { side: THREE.BackSide, roughness: 0.42, clippingPlanes: [] }));
  gShell.add(bore);

  /* ----------------------------------------------------------- end caps */
  const capMat = steelMat(C.cap, { roughness: 0.24 });
  [1, -1].forEach(sgn => {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(RO + 0.85, RO + 0.85, 1.9, 64), capMat);
    cap.position.y = sgn * (L / 2 + 0.55);
    cap.castShadow = true; gCaps.add(cap);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(RO + 0.25, RO + 0.25, 1.1, 64), capMat);
    collar.position.y = sgn * (L / 2 - 0.3); gCaps.add(collar);
    for (let i = 0; i < 8; i++) {                        // clamp bolts
      const a = (i / 8) * Math.PI * 2;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 2.5, 6),
        steelMat(C.steelDark, { roughness: 0.5 }));
      bolt.position.set(Math.cos(a) * (RO + 0.55), sgn * (L / 2 + 0.55), Math.sin(a) * (RO + 0.55));
      bolt.castShadow = true; gCaps.add(bolt);
    }
  });

  /* ---------------------------------------------------------- screens */
  const screenMat = new THREE.MeshStandardMaterial({
    color: C.screen, metalness: 0.85, roughness: 0.55,
    transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  [bedY0, bedY0 + bedH].forEach(y => {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.02, 0.22, 64), screenMat);
    s.position.y = y; gScreens.add(s);
  });

  /* -------------------------------------------------------------- bed */
  // Packed bed as instanced particles. Radius and count give a realistic packing
  // density for the granular form without simulating contact mechanics.
  const BED_N = 2600;
  const pr = 0.30;
  const bedGeo = new THREE.SphereGeometry(pr, 10, 8);
  const zeoMat = new THREE.MeshStandardMaterial({ color: dims.bedColor, roughness: 0.82, metalness: 0.04 });
  const carbMat = new THREE.MeshStandardMaterial({ color: C.carbon, roughness: 0.95, metalness: 0.02 });
  const nCarbon = dims.showCarbon ? Math.round(BED_N * dims.carbonFraction) : 0;
  const bedZeo = new THREE.InstancedMesh(bedGeo, zeoMat, BED_N - nCarbon);
  const bedCarb = new THREE.InstancedMesh(bedGeo, carbMat, Math.max(nCarbon, 1));
  bedZeo.castShadow = bedCarb.castShadow = true;
  bedZeo.receiveShadow = bedCarb.receiveShadow = true;
  if (nCarbon === 0) bedCarb.count = 0;
  gBed.add(bedZeo, bedCarb);

  const sites = [];                        // adsorption sites for the flow animation
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let zi = 0, ci = 0;
    for (let i = 0; i < BED_N; i++) {
      const rr = Math.sqrt(Math.random()) * (R - pr * 1.15);
      const th = Math.random() * Math.PI * 2;
      const y = bedY0 + 0.25 + Math.random() * (bedH - 0.5);
      const p = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
      const sc = 0.72 + Math.random() * 0.5;
      q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
      m.compose(p, q, s.set(sc, sc, sc));
      const isCarbon = nCarbon > 0 && i % Math.round(BED_N / nCarbon) === 0 && ci < nCarbon;
      if (isCarbon) bedCarb.setMatrixAt(ci++, m);
      else if (zi < BED_N - nCarbon) bedZeo.setMatrixAt(zi++, m);
      if (sites.length < 900) sites.push(p.clone().multiplyScalar(1.0));
    }
    bedZeo.count = zi; bedCarb.count = ci;
    bedZeo.instanceMatrix.needsUpdate = bedCarb.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------- bath */
  const bathW = RO * 2 + 13, bathD = RO * 2 + 11, bathH = L * 0.72;
  const bathY = -L / 2 - 1 + bathH / 2 - 1.5;
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xdceaf4, metalness: 0.05, roughness: 0.12,
    transparent: true, opacity: 0.17, side: THREE.DoubleSide,
    depthWrite: false, envMapIntensity: 1.3 });
  const tank = new THREE.Mesh(new THREE.BoxGeometry(bathW, bathH, bathD), glassMat);
  tank.position.y = bathY; gBath.add(tank);
  const tankEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(tank.geometry),
    new THREE.LineBasicMaterial({ color: 0x7f96ab, transparent: true, opacity: 0.85 }));
  tankEdges.position.y = bathY; gBath.add(tankEdges);
  const liqH = bathH * dims.bathFill;
  const liquid = new THREE.Mesh(
    new THREE.BoxGeometry(bathW - 0.7, liqH, bathD - 0.7),
    new THREE.MeshStandardMaterial({ color: 0x6fc2e0, metalness: 0.1, roughness: 0.18,
      transparent: true, opacity: 0.42, depthWrite: false, envMapIntensity: 1.1 }));
  liquid.position.y = bathY - bathH / 2 + liqH / 2; gBath.add(liquid);
  const surf = new THREE.Mesh(
    new THREE.PlaneGeometry(bathW - 0.7, bathD - 0.7).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x9fd9ee, roughness: 0.08, metalness: 0.25,
      transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  surf.position.y = liquid.position.y + liqH / 2; gBath.add(surf);

  const iceGeo = new THREE.DodecahedronGeometry(0.62, 0);
  const ice = new THREE.InstancedMesh(iceGeo,
    new THREE.MeshStandardMaterial({ color: C.dryIce, roughness: 0.72, metalness: 0 }), 90);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < 90; i++) {
      let x, z, tries = 0;
      do { x = (Math.random() - 0.5) * (bathW - 2.4); z = (Math.random() - 0.5) * (bathD - 2.4); tries++; }
      while (Math.hypot(x, z) < RO + 1.1 && tries < 25);
      const y = liquid.position.y - liqH / 2 + 0.7 + Math.random() * (liqH * 0.55);
      q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
      const sc = 0.55 + Math.random() * 0.7;
      m.compose(new THREE.Vector3(x, y, z), q, s.set(sc, sc, sc));
      ice.setMatrixAt(i, m);
    }
    ice.instanceMatrix.needsUpdate = true;
  }
  gBath.add(ice);

  /* ----------------------------------------------------------- piping */
  const pipeMat = steelMat(0xc4ccd4, { roughness: 0.22 });
  function pipe(points, r = 0.55) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, r, 18, false), pipeMat);
    m.castShadow = true; gPiping.add(m); return curve;
  }
  const inletCurve = pipe([
    [-14, L / 2 + 7.2, 3.5], [-8.5, L / 2 + 7, 2.6], [-3.6, L / 2 + 6.2, 1.2],
    [0, L / 2 + 5.6, 0], [0, L / 2 + 2.6, 0],
  ]);
  pipe([[0, -L / 2 - 1.5, 0], [0, -L / 2 - 4.5, 0], [7, -L / 2 - 5.5, 0], [15, -L / 2 - 5.5, 0]]);

  // regulator body + valve handles
  const reg = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.2), steelMat(0xaab4bf, { roughness: 0.3 }));
  reg.position.set(-8.5, L / 2 + 7, 2.6); reg.castShadow = true; gPiping.add(reg);
  [[-3.9, L / 2 + 6.3, 1.3], [10, -L / 2 - 5.5, 0]].forEach(p => {
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.7, 20), steelMat(C.brass, { roughness: 0.34 }));
    v.position.set(...p); v.castShadow = true; gPiping.add(v);
    const h = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.16, 10, 28), steelMat(0xd05a3a, { metalness: 0.3, roughness: 0.5 }));
    h.position.set(p[0], p[1] + 0.85, p[2]); h.rotation.x = Math.PI / 2; gPiping.add(h);
  });

  // pressure gauge PI-101
  const gauge = new THREE.Group();
  const gBody = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.75, 40), steelMat(0xc9a227, { roughness: 0.3 }));
  gBody.rotation.z = Math.PI / 2; gauge.add(gBody);
  const faceCv = document.createElement("canvas"); faceCv.width = faceCv.height = 256;
  const fx = faceCv.getContext("2d");
  fx.fillStyle = "#f7f9fb"; fx.beginPath(); fx.arc(128, 128, 124, 0, 7); fx.fill();
  fx.strokeStyle = "#22303d"; fx.lineWidth = 5;
  for (let i = 0; i <= 20; i++) {
    const a = -Math.PI * 1.25 + (i / 20) * Math.PI * 1.5;
    const r1 = i % 5 === 0 ? 92 : 104;
    fx.beginPath(); fx.moveTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1);
    fx.lineTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116); fx.stroke();
  }
  fx.fillStyle = "#22303d"; fx.font = "bold 26px system-ui"; fx.textAlign = "center";
  fx.fillText("bar", 128, 186);
  const faceTex = new THREE.CanvasTexture(faceCv);
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.75, 48),
    new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.35, metalness: 0 }));
  face.position.x = 0.4; face.rotation.y = Math.PI / 2; gauge.add(face);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.35, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }));
  needle.position.set(0.46, 0, 0); needle.geometry.translate(0, 0.62, 0);
  gauge.add(needle);
  gauge.position.set(4.2, L / 2 + 3.4, 0);
  gPiping.add(gauge);

  /* ------------------------------------------------------- heating tape */
  if (dims.heatingTape) {
    const tapeMat = new THREE.MeshStandardMaterial({ color: C.tape, roughness: 0.75, metalness: 0.05,
      transparent: true, opacity: 0.85 });
    for (let i = 0; i < 7; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(RO + 0.14, 0.2, 10, 60), tapeMat);
      t.position.y = bedY0 + 1.5 + i * (bedH - 3) / 6;
      t.rotation.x = Math.PI / 2; gTape.add(t);
    }
  }

  /* -------------------------------------------------------------- flow */
  const FLOW_N = 340;
  const flowGeo = new THREE.SphereGeometry(0.19, 8, 6);
  const flowMat = new THREE.MeshStandardMaterial({ color: C.hydrogen, emissive: C.hydrogen,
    emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.1 });
  const adsMat = new THREE.MeshStandardMaterial({ color: C.adsorbed, emissive: C.adsorbed,
    emissiveIntensity: 0.3, roughness: 0.4, metalness: 0.1 });
  const flow = new THREE.InstancedMesh(flowGeo, flowMat, FLOW_N);
  const adsorbed = new THREE.InstancedMesh(flowGeo, adsMat, sites.length);
  adsorbed.count = 0;
  gFlow.add(flow, adsorbed);

  const parts = Array.from({ length: FLOW_N }, () => ({
    t: Math.random(), speed: 0.0022 + Math.random() * 0.0034,
    jitter: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5),
    target: null, phase: "pipe", prog: 0,
  }));

  /* ------------------------------------------------------------- labels */
  const labelLayer = document.createElement("div");
  labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
  container.appendChild(labelLayer);
  const LABELS = [
    { id: "vessel",  text: cfg.vesselLabel || "V-101 · SS316, ID 50 × 250 mm",
                     pos: [RO + 7.5, L * 0.30, 0] },
    { id: "bed",     text: cfg.bedLabel || "Adsorbent bed",  pos: [-RO - 7.5, bedY0 + bedH * 0.45, 0] },
    { id: "gauge",   text: cfg.gaugeLabel || "PI-101 · 0–20 bar", pos: [9.5, L / 2 + 3.6, 0] },
    { id: "CB-101",  text: cfg.bathLabel || "CB-101 · dry ice + acetone",
                     pos: [-bathW / 2 - 3, bathY - bathH * 0.16, bathD / 2 - 1] },
  ];
  const labelEls = LABELS.map(l => {
    const el = document.createElement("div");
    el.className = "v3d-label";
    el.textContent = l.text;
    labelLayer.appendChild(el);
    return { ...l, el, v: new THREE.Vector3(...l.pos) };
  });

  /* --------------------------------------------------------------- state */
  let state = { pressure: 1, temperature: 195, saturation: 0, flowing: true, stage: "idle" };
  let cutaway = true, showLabels = true, running = true, raf = 0;

  function applyCutaway(on) {
    cutaway = on;
    const planes = on ? [clipPlane] : [];
    [shellMat, ...[tank.material, liquid.material]].forEach(m => {
      m.clippingPlanes = planes; m.needsUpdate = true;
    });
    bore.material.clippingPlanes = planes; bore.material.needsUpdate = true;
    hooks.onCutaway?.(on);
  }

  /* ---------------------------------------------------------------- loop */
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
        _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _proj = new THREE.Vector3();
  let adsCount = 0;

  function step(dtScale) {
    const targetAds = Math.round(THREE.MathUtils.clamp(state.saturation, 0, 1) * sites.length);
    let live = 0;

    for (const part of parts) {
      if (part.phase === "pipe") {
        part.t += part.speed * dtScale * (state.flowing ? 1 : 0.06);
        if (part.t >= 1) {
          part.t = 0;
          if (adsCount < targetAds) { part.phase = "settling"; part.prog = 0; part.target = sites[adsCount]; }
        }
        inletCurve.getPointAt(Math.min(part.t, 1), _p);
        _p.add(part.jitter);
      } else {
        part.prog += 0.028 * dtScale;
        const from = inletCurve.getPointAt(1);
        _p.lerpVectors(from, part.target, Math.min(part.prog, 1));
        _p.x += Math.sin(part.prog * 7) * 0.35 * (1 - part.prog);
        _p.z += Math.cos(part.prog * 6) * 0.35 * (1 - part.prog);
        if (part.prog >= 1) {
          _m.compose(part.target, _q, _s);
          if (adsCount < adsorbed.instanceMatrix.count) {
            adsorbed.setMatrixAt(adsCount++, _m);
            adsorbed.count = adsCount;
            adsorbed.instanceMatrix.needsUpdate = true;
          }
          part.phase = "pipe"; part.t = Math.random() * 0.2; part.target = null;
          continue;
        }
      }
      _m.compose(_p, _q, _s);
      flow.setMatrixAt(live++, _m);
    }
    flow.count = live;
    flow.instanceMatrix.needsUpdate = true;

    if (adsCount > targetAds) { adsCount = targetAds; adsorbed.count = adsCount; }

    // gauge needle: 0-20 bar over 270 degrees
    needle.rotation.x = 0;
    needle.rotation.z = 0;
    needle.rotation.x = -Math.PI * 1.25 + (THREE.MathUtils.clamp(state.pressure, 0, 20) / 20) * Math.PI * 1.5 + Math.PI / 2;

    if (dims.heatingTape) {
      const hot = state.temperature > 273;
      gTape.children.forEach(t => {
        t.material.emissive.setHex(hot ? 0xff5533 : 0x000000);
        t.material.emissiveIntensity = hot ? 0.45 + Math.sin(performance.now() / 320) * 0.12 : 0;
      });
    }
  }

  function updateLabels() {
    if (!showLabels) return;
    const w = container.clientWidth, h = container.clientHeight;
    for (const l of labelEls) {
      _proj.copy(l.v).project(camera);
      const vis = _proj.z < 1;
      l.el.style.display = vis ? "block" : "none";
      if (!vis) continue;
      l.el.style.transform =
        `translate(-50%,-50%) translate(${(_proj.x * 0.5 + 0.5) * w}px,${(-_proj.y * 0.5 + 0.5) * h}px)`;
    }
  }

  let last = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 16.67, 3); last = now;
    if (running) step(dt);
    controls.update();
    updateLabels();
    renderer.render(scene, camera);
  }

  function resize() {
    const w = container.clientWidth || 640, h = container.clientHeight || 420;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  applyCutaway(true);
  const ro = new ResizeObserver(resize); ro.observe(container);
  resize(); loop(performance.now());

  /* ------------------------------------------------------------- public */
  return {
    setState(s) { Object.assign(state, s); },
    setCutaway: applyCutaway,
    toggleCutaway() { applyCutaway(!cutaway); return cutaway; },
    setLayer(name, on) { if (layers[name]) layers[name].visible = on; },
    getLayers() { return Object.keys(layers); },
    setLabels(on) {
      showLabels = on;
      labelEls.forEach(l => l.el.style.display = on ? "block" : "none");
    },
    setRunning(on) { running = on; },
    resetView() {
      camera.position.set(40, 15, 47);
      controls.target.set(0, -1, 0); controls.update();
    },
    resetAdsorption() { adsCount = 0; adsorbed.count = 0; },
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      scene.traverse(o => { o.geometry?.dispose?.();
        (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(m => m.dispose()); });
      renderer.dispose(); container.innerHTML = "";
    },
  };
}
