import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CaseSpec, Layout } from '../types';
import { baseDepth, dividerHeight, footprint, wallInset, wheelSide, type DividerSolve, type Issue } from '../lib/geometry';
import type { ViewRot } from './Editor2D';

interface Props {
  layout: Layout;
  c: CaseSpec;
  solve: DividerSolve;
  issues: Issue[];
  showLid: boolean;
  selectedId?: string;
  /** matches the plan view, so 3D faces the same way */
  rot: ViewRot;
  /** standing = resting on the edge at the bottom of the plan view, open side facing you */
  pose: 'flat' | 'standing';
}

const WALL = 9;

function labelTexture(text: string, color: string, w: number, d: number): THREE.CanvasTexture {
  const scale = 4;
  const cw = Math.max(32, Math.round(w * scale));
  const ch = Math.max(32, Math.round(d * scale));
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const g = cv.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(0, 0, cw, ch * 0.35);
  g.fillStyle = '#fff';
  let size = Math.min(ch * 0.3, (cw * 1.5) / Math.max(4, text.length));
  g.font = `600 ${size}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cw / 2, ch / 2, cw * 0.92);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function Preview3D({ layout, c, solve, issues, showLid, selectedId, rot, pose }: Props) {
  const wheels = wheelSide(layout, c);
  const hostRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    group: THREE.Group;
    yaw: THREE.Group;
    posed: THREE.Group;
    ground: THREE.Mesh;
    fittedFor?: string;
  }>();

  // One-time renderer setup.
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-400, 900, 500);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -700;
    sc.right = sc.top = 700;
    scene.add(sun);
    // posed (tip up to stand) > yaw (match the plan rotation) > group (the case, lying flat)
    const posed = new THREE.Group();
    const yaw = new THREE.Group();
    const group = new THREE.Group();
    yaw.add(group);
    posed.add(yaw);
    scene.add(posed);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.ShadowMaterial({ opacity: 0.28 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    ctx.current = { renderer, scene, camera, controls, group, yaw, posed, ground };

    const resize = () => {
      const r = host.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / Math.max(1, r.height);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  // Rebuild the model whenever the layout changes.
  useEffect(() => {
    const k = ctx.current;
    if (!k) return;
    const { group, camera, controls, yaw, posed, ground } = k;
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mat) => {
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      });
    });
    group.clear();

    const base = baseDepth(c);
    const pad = layout.settings.floorPad;
    const ins = wallInset(layout);
    const t = layout.settings.dividerThickness;
    const dh = dividerHeight(layout, c);
    const errs = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.target));
    // Centre the case on the origin; case x -> world x, case y -> world z.
    const X = (x: number) => x - c.l / 2;
    const Z = (y: number) => y - c.w / 2;

    const box = (w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, shadow = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      group.add(m);
      return m;
    };

    const shellMat = new THREE.MeshStandardMaterial({ color: 0x202327, roughness: 0.75 });
    // floor + walls of the base
    box(c.l + 2 * WALL, 6, c.w + 2 * WALL, shellMat, 0, -3, 0, false);
    box(c.l + 2 * WALL, base, WALL, shellMat, 0, base / 2, -c.w / 2 - WALL / 2);
    box(c.l + 2 * WALL, base, WALL, shellMat, 0, base / 2, c.w / 2 + WALL / 2);
    box(WALL, base, c.w, shellMat, -c.l / 2 - WALL / 2, base / 2, 0);
    box(WALL, base, c.w, shellMat, c.l / 2 + WALL / 2, base / 2, 0);

    // Hardware: hinges on the back (plan y = 0), handle and latches on the front (plan y = w),
    // wheels on one short end along the bottom edge, front and back corners.
    const hwMat = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.5 });
    const latchMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.4, metalness: 0.2 });
    const frontZ = c.w / 2 + WALL;
    const backZ = -c.w / 2 - WALL;
    const handleW = Math.min(c.l * 0.32, 160);
    box(handleW, 14, 16, hwMat, 0, base - 12, frontZ + 10);
    const latchXs = c.l > 600 ? [-0.32, 0.32] : [-0.3, 0.3];
    for (const fx of latchXs) box(Math.min(30, c.l * 0.08), 30, 8, latchMat, fx * c.l, base - 16, frontZ + 4);
    for (const fx of c.l > 450 ? [-0.3, 0, 0.3] : [-0.25, 0.25]) box(20, 14, 10, hwMat, fx * c.l, base - 8, backZ - 5);
    if (wheels !== 'none') {
      const r = 26;
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 });
      const hubMat = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.4, metalness: 0.5 });
      const ex = (wheels === 'left' ? -1 : 1) * (c.l / 2 + WALL - r * 0.45);
      // Along the end's bottom edge, at the front and back corners; axles run front-to-back.
      const doubled = (c.wheels ?? 2) >= 4;
      const cornerZ = c.w / 2 + WALL - 16;
      for (const side of [-1, 1]) {
        for (const k of doubled ? [0, 1] : [0]) {
          const z = side * (cornerZ - k * 26);
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 20, 28), wheelMat);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(ex, r * 0.55, z);
          wheel.castShadow = true;
          group.add(wheel);
          const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 22, 20), hubMat);
          hub.rotation.x = Math.PI / 2;
          hub.position.copy(wheel.position);
          group.add(hub);
        }
      }
    }

    if (pad > 0) {
      const foam = new THREE.MeshStandardMaterial({ color: layout.style === 'foam' ? 0x2e3136 : 0x34373c, roughness: 1 });
      box(c.l - 2 * ins, pad, c.w - 2 * ins, foam, 0, pad / 2, 0, false);
    }

    const panelMat = new THREE.MeshStandardMaterial({ color: layout.style === 'trekpak' ? 0x8f969e : 0x3b4250, roughness: 0.85 });
    if (ins > 0) {
      box(c.l, dh, ins, panelMat, 0, dh / 2, Z(ins / 2));
      box(c.l, dh, ins, panelMat, 0, dh / 2, Z(c.w - ins / 2));
      box(ins, dh, c.w - 2 * ins, panelMat, X(ins / 2), dh / 2, 0);
      box(ins, dh, c.w - 2 * ins, panelMat, X(c.l - ins / 2), dh / 2, 0);
    }
    if (layout.style === 'trekpak' || layout.style === 'padded') {
      for (const d of solve.resolved.values()) {
        const r = d.rect;
        const m = box(r.w, dh, r.h, panelMat, X(r.x + r.w / 2), dh / 2, Z(r.y + r.h / 2));
        if (d.uid === selectedId) (m.material = panelMat.clone()), ((m.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x1d5fd6));
      }
    }
    void t;

    for (const it of layout.items) {
      const f = footprint(it);
      const color = new THREE.Color(it.color);
      const side = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
      let topMap: THREE.Texture;
      if (it.image) {
        topMap = new THREE.TextureLoader().load(it.image);
        topMap.colorSpace = THREE.SRGBColorSpace;
      } else {
        topMap = labelTexture(it.label, it.color, f.w, f.d);
        // Keep painted labels readable when the case is turned past 90°.
        if (rot === 180 || rot === 270) {
          topMap.center.set(0.5, 0.5);
          topMap.rotation = Math.PI;
        }
      }
      const top = new THREE.MeshStandardMaterial({ map: topMap, roughness: 0.55 });
      if (errs.has(it.uid)) {
        side.emissive = new THREE.Color(0x8a1010);
        top.emissive = new THREE.Color(0x400808);
      } else if (it.uid === selectedId) {
        side.emissive = new THREE.Color(0x0c2e6e);
      }
      // BoxGeometry face order: +x, -x, +y (top), -y, +z, -z
      box(f.w, f.h, f.d, [side, side, top, side, side, side], X(it.x + f.w / 2), pad + f.h / 2, Z(it.y + f.d / 2));
    }

    if (showLid && c.lid) {
      const lidMat = new THREE.MeshStandardMaterial({ color: 0x5aa0ff, transparent: true, opacity: 0.12, depthWrite: false });
      box(c.l, c.d - base, c.w, lidMat, 0, base + (c.d - base) / 2, 0, false);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(c.l, c.d - base, c.w)),
        new THREE.LineBasicMaterial({ color: 0x5aa0ff, transparent: true, opacity: 0.6 }),
      );
      edges.position.set(0, base + (c.d - base) / 2, 0);
      group.add(edges);
    }

    // Turn the case to match the plan view, then stand it on the plan's bottom edge if asked.
    yaw.rotation.y = (-rot * Math.PI) / 180;
    const turned = rot === 90 || rot === 270;
    // At 0° it rests on its handle (hinge up); at 180° on the hinges.
    const downExtent = (turned ? c.l : c.w) / 2 + WALL + (rot === 0 ? 26 : rot === 180 ? 10 : (rot === 270 && wheels === 'left') || (rot === 90 && wheels === 'right') ? 12 : 0);
    if (pose === 'standing') {
      posed.rotation.x = Math.PI / 2;
      posed.position.set(0, downExtent, -base / 2);
      ground.position.y = 0;
    } else {
      posed.rotation.x = 0;
      posed.position.set(0, 0, 0);
      ground.position.y = -6;
    }

    // Frame the camera once per case size / pose, so edits don't yank the view around.
    const key = `${c.l}x${c.w}x${c.d}:${pose}:${rot}:${camera.aspect.toFixed(2)}`;
    if (k.fittedFor !== key) {
      const r = Math.max(c.l, c.w) * 1.25;
      if (pose === 'standing') {
        // Fit the whole standing case: height 2·downExtent, width = the other plan side.
        const tanHalf = Math.tan(((camera.fov / 2) * Math.PI) / 180);
        const width = (turned ? c.w : c.l) + 2 * WALL;
        const dist = 1.35 * Math.max(downExtent / tanHalf, width / 2 / (tanHalf * Math.max(camera.aspect, 0.3))) + c.d;
        camera.position.set(-dist * 0.3, downExtent + dist * 0.18, dist * 0.94);
        controls.target.set(0, downExtent, 0);
      } else {
        camera.position.set(-r * 0.55, r * 0.95, r * 0.95);
        controls.target.set(0, base * 0.3, 0);
      }
      controls.update();
      k.fittedFor = key;
    }
  }, [layout, c, solve, issues, showLid, selectedId, rot, pose, wheels]);

  return <div ref={hostRef} className="preview3d" />;
}
