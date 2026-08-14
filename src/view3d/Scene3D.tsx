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
  /** Vrai des que l'utilisateur a bouge la camera : on cesse alors de recadrer tout seul. */
  const userMovedRef = useRef(false);
  const presetRef = useRef<View3DPreset>('exterieur');
  const applyPresetRef = useRef<(p: View3DPreset) => void>(() => {});

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

    controls.addEventListener('start', () => {
      userMovedRef.current = true;
    });

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      // Le troisieme argument doit rester a `true` : sans mise a jour du style,
      // le canevas garde la taille de son tampon (multipliee par le rapport de
      // pixels de l'ecran) et deborde du conteneur sur les ecrans haute densite.
      renderer.setSize(w, h, true);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Le cadrage depend des proportions de l'image : tant que l'utilisateur
      // n'a pas pris la main, on le recalcule (premiere mise en page, rotation
      // de l'ecran, ouverture d'un panneau).
      if (!userMovedRef.current) applyPresetRef.current(presetRef.current);
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

    // La brume doit s'adapter a la taille du local : une portee fixe faisait
    // disparaitre les grands magasins dans le fond, une fois la camera reculee.
    const r = Math.max(1, built.bounds.getBoundingSphere(new THREE.Sphere()).radius);
    scene.fog = new THREE.Fog('#0f1318', Math.max(25, r * 2.5), Math.max(90, r * 8));
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
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(1, sphere.radius);

      /**
       * Distance a laquelle une sphere de rayon `radius` tient entierement dans
       * l'image. On retient le plus etroit des deux champs de vision : sur un
       * ecran haut et etroit c'est l'horizontal qui contraint le cadrage, et
       * l'ignorer rejetait la maquette hors de l'ecran sur telephone.
       */
      const fitDistance = (margin = 1.12): number => {
        const vFov = (camera.fov * Math.PI) / 180;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.1, camera.aspect));
        return (radius * margin) / Math.sin(Math.min(vFov, hFov) / 2);
      };

      if (p === 'dessus') {
        const d = fitDistance();
        // Le leger decalage en Z evite la singularite de la camera a la verticale.
        camera.position.set(center.x, center.y + d, center.z + d * 0.001);
        controls.target.set(center.x, 0, center.z);
        controls.maxPolarAngle = Math.PI * 0.499;
        controls.minDistance = 1;
        controls.maxDistance = d * 4;
      } else if (p === 'interieur') {
        const pose = interiorPose(project);
        camera.position.copy(pose.position);
        controls.target.copy(pose.target);
        controls.maxPolarAngle = Math.PI * 0.85;
        controls.minDistance = 0.4;
        controls.maxDistance = Math.max(20, radius * 3);
      } else {
        const d = fitDistance();
        // Vue en trois quarts, la plus lisible pour saisir un volume.
        const dir = new THREE.Vector3(0.72, 0.5, 0.95).normalize();
        camera.position.copy(center).addScaledVector(dir, d);
        controls.target.copy(center);
        controls.maxPolarAngle = Math.PI * 0.495;
        controls.minDistance = 1;
        controls.maxDistance = d * 4;
      }
      camera.updateProjectionMatrix();
      controls.update();
    },
    [project],
  );

  // Le gestionnaire de redimensionnement, cree au montage, doit pouvoir
  // appeler la version courante du cadrage.
  useEffect(() => {
    applyPresetRef.current = applyPreset;
    presetRef.current = preset;
  }, [applyPreset, preset]);

  /** Cadrage demande explicitement : on reprend la main sur la camera. */
  const recenter = useCallback(
    (p: View3DPreset) => {
      userMovedRef.current = false;
      applyPreset(p);
    },
    [applyPreset],
  );

  // Cadrage initial, puis a chaque changement de vue demande
  useEffect(() => {
    if (!ready) return;
    userMovedRef.current = false;
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
                recenter(id);
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
          <button type="button" onClick={() => recenter(preset)} title="Recadrer">
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
