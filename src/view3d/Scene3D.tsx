import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useEditor } from '../state/store';
import { buildScene, interiorPose, type BuiltScene } from './builders';
import { slug } from '../state/projects';

export type View3DPreset = 'exterieur' | 'interieur' | 'dessus';

/** Reference exposee pour permettre l'export d'une image depuis la barre d'outils. */
export interface Scene3DHandle {
  snapshot: () => string | null;
}

let snapshotFn: (() => string | null) | null = null;

/** Capture la vue 3D courante en PNG (retourne une data-URL, ou null). */
export function capture3D(): string | null {
  return snapshotFn ? snapshotFn() : null;
}

export function download3DImage(projectName: string): boolean {
  const url = capture3D();
  if (!url) return false;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug(projectName)}-vue-3d.png`;
  a.click();
  return true;
}

export default function Scene3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const builtRef = useRef<BuiltScene | null>(null);
  const frameRef = useRef<number>(0);
  const [preset, setPreset] = useState<View3DPreset>('exterieur');
  const [ready, setReady] = useState(false);

  const project = useEditor((s) => s.project);
  const notify = useEditor((s) => s.notify);

  // ------------------------------------------------------- initialisation WebGL
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0f1318');
    scene.fog = new THREE.Fog('#0f1318', 40, 140);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
    camera.position.set(12, 12, 16);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        // Necessaire pour pouvoir exporter la vue en image.
        preserveDrawingBuffer: true,
      });
    } catch {
      notify("Votre navigateur ne permet pas l'affichage 3D (WebGL indisponible).", 'error');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.screenSpacePanning = false;
    controlsRef.current = controls;

    // --- Eclairage : ciel diffus + soleil directionnel + appoint interieur
    const hemi = new THREE.HemisphereLight('#dfeaf5', '#3b3a37', 1.15);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fff6e8', 2.1);
    sun.position.set(18, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    scene.add(sun.target);

    const fill = new THREE.DirectionalLight('#cfe3ff', 0.55);
    fill.position.set(-14, 14, -12);
    scene.add(fill);

    const ambient = new THREE.AmbientLight('#ffffff', 0.35);
    scene.add(ambient);

    snapshotFn = () => {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = cameraRef.current;
      if (!r || !s || !c) return null;
      r.render(s, c);
      return r.domElement.toDataURL('image/png');
    };

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    const loop = () => {
      frameRef.current = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    setReady(true);

    return () => {
      cancelAnimationFrame(frameRef.current);
      ro.disconnect();
      controls.dispose();
      builtRef.current?.dispose();
      builtRef.current = null;
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      snapshotFn = null;
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
    // Volontairement monte une seule fois : le contenu est mis a jour separement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------- (re)construction du contenu
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;
    if (builtRef.current) {
      scene.remove(builtRef.current.root);
      builtRef.current.dispose();
    }
    const built = buildScene(project);
    builtRef.current = built;
    scene.add(built.root);
  }, [project, ready]);

  // ------------------------------------------------------------ cadrage camera
  const applyPreset = useCallback(
    (p: View3DPreset) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const built = builtRef.current;
      if (!camera || !controls || !built) return;

      const box = built.bounds;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.z) * 0.5 + 2;

      if (p === 'dessus') {
        camera.position.set(center.x, Math.max(12, radius * 2.1), center.z + 0.01);
        controls.target.set(center.x, 0, center.z);
        controls.maxPolarAngle = Math.PI * 0.499;
        controls.minDistance = 2;
        controls.maxDistance = 300;
      } else if (p === 'interieur') {
        const pose = interiorPose(project);
        camera.position.copy(pose.position);
        controls.target.copy(pose.target);
        controls.maxPolarAngle = Math.PI * 0.85;
        controls.minDistance = 0.4;
        controls.maxDistance = 60;
      } else {
        camera.position.set(center.x + radius * 1.25, radius * 1.05 + 4, center.z + radius * 1.5);
        controls.target.set(center.x, size.y * 0.35, center.z);
        controls.maxPolarAngle = Math.PI * 0.495;
        controls.minDistance = 1;
        controls.maxDistance = 300;
      }
      camera.updateProjectionMatrix();
      controls.update();
    },
    [project],
  );

  // Cadrage initial, puis a chaque changement de vue demande
  useEffect(() => {
    if (!ready) return;
    applyPreset(preset);
  }, [preset, ready, applyPreset]);

  const zoom = (factor: number) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const dir = camera.position.clone().sub(controls.target);
    const d = Math.max(0.2, Math.min(400, dir.length() * factor));
    camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(d));
    controls.update();
  };

  return (
    <div className="canvas-wrap">
      <div ref={mountRef} className="scene3d-mount" />
      <div className="scene3d-toolbar">
        <div className="seg">
          {(
            [
              ['exterieur', 'Extérieur'],
              ['interieur', 'Intérieur'],
              ['dessus', 'Vue de dessus'],
            ] as Array<[View3DPreset, string]>
          ).map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              className={preset === id ? 'active' : ''}
              onClick={() => {
                setPreset(id);
                applyPreset(id);
              }}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="seg">
          <button type="button" onClick={() => zoom(1 / 1.2)} title="Zoom avant">
            +
          </button>
          <button type="button" onClick={() => zoom(1.2)} title="Zoom arrière">
            −
          </button>
          <button type="button" onClick={() => applyPreset(preset)} title="Recadrer">
            Recadrer
          </button>
        </div>
      </div>
      <div className="canvas-hint bottom">
        Glisser : orbiter — Clic droit / 2 doigts : déplacer — Molette : zoomer — Hauteur sous plafond&nbsp;:{' '}
        {project.settings.wallHeight.toFixed(2)} m
      </div>
    </div>
  );
}
