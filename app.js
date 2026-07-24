import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/OBJLoader.js";
import { GLTFExporter } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/exporters/OBJExporter.js";
import { mergeGeometries } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js";

const viewport = document.querySelector("#viewport");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101216);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
camera.position.set(4.5, 3.2, 6.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 1, 0);

const transform = new TransformControls(camera, renderer.domElement);
transform.setMode("translate");
transform.addEventListener("dragging-changed", e => orbit.enabled = !e.value);
scene.add(transform.getHelper());

scene.add(new THREE.HemisphereLight(0xffffff, 0x38404d, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(4, 8, 5);
keyLight.castShadow = true;
scene.add(keyLight);

const grid = new THREE.GridHelper(20, 20, 0x626975, 0x303641);
scene.add(grid);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const editableObjects = [];
let selectedObject = null;
let selectedLayerId = "body";
let objectCounter = 1;
let layerCounter = 1;

const layers = [
  { id: "body", name: "Body", visible: true, locked: false, textures: {} },
  { id: "head", name: "Head", visible: true, locked: false, textures: {} },
  { id: "hair", name: "Hair", visible: true, locked: false, textures: {} },
  { id: "clothing", name: "Clothing", visible: true, locked: false, textures: {} }
];

const textureState = new Map();
const paintCanvas = document.querySelector("#paintCanvas");
const pctx = paintCanvas.getContext("2d", { willReadFrequently: true });
let painting = false;
let lastPoint = null;
let paintTool = "brush";
let undoStack = [];
let redoStack = [];

function setStatus(text) {
  document.querySelector("#statusText").textContent = text;
}

function resizeRenderer() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeRenderer);
resizeRenderer();

function materialForObject() {
  return new THREE.MeshStandardMaterial({
    color: 0xb8bcc4,
    roughness: 0.75,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
}

function ensureUv(geometry) {
  if (geometry.attributes.uv) return;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const size = new THREE.Vector3();
  box.getSize(size);
  const pos = geometry.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  const sx = size.x || 1;
  const sy = size.y || 1;
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = (pos.getX(i) - box.min.x) / sx;
    uvs[i * 2 + 1] = (pos.getY(i) - box.min.y) / sy;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

function addMesh(geometry, name, layerId = selectedLayerId) {
  ensureUv(geometry);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, materialForObject());
  mesh.name = `${name} ${objectCounter++}`;
  mesh.userData.layerId = layerId;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  editableObjects.push(mesh);
  selectObject(mesh);
  refreshUI();
  setStatus(`${mesh.name} added`);
  return mesh;
}

function addPrimitive(type) {
  const geometries = {
    box: () => new THREE.BoxGeometry(1, 1, 1, 2, 2, 2),
    sphere: () => new THREE.SphereGeometry(0.65, 32, 20),
    capsule: () => new THREE.CapsuleGeometry(0.45, 1.0, 8, 18),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1.4, 24, 4),
    cone: () => new THREE.ConeGeometry(0.6, 1.4, 24, 4),
    plane: () => new THREE.PlaneGeometry(1.5, 1.5, 4, 4)
  };
  const labels = { box: "Cube", sphere: "Sphere", capsule: "Capsule", cylinder: "Cylinder", cone: "Cone", plane: "Plane" };
  addMesh(geometries[type](), labels[type]);
}

function selectObject(obj) {
  selectedObject = obj;
  if (obj) {
    selectedLayerId = obj.userData.layerId || selectedLayerId;
    transform.attach(obj);
    document.querySelector("#objectName").value = obj.name;
    document.querySelector("#objectLayer").value = obj.userData.layerId;
    document.querySelector("#selectionStatus").textContent = obj.name;
  } else {
    transform.detach();
    document.querySelector("#selectionStatus").textContent = "Nothing selected";
  }
  refreshObjectsList();
  refreshLayersList();
}

function removeObject(obj) {
  if (!obj) return;
  transform.detach();
  scene.remove(obj);
  const index = editableObjects.indexOf(obj);
  if (index >= 0) editableObjects.splice(index, 1);
  obj.geometry?.dispose?.();
  if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
  else obj.material?.dispose?.();
  selectedObject = null;
  refreshUI();
}

function duplicateSelected() {
  if (!selectedObject) return;
  const copy = selectedObject.clone();
  copy.geometry = selectedObject.geometry.clone();
  copy.material = selectedObject.material.clone();
  copy.position.x += 0.35;
  copy.name = `${selectedObject.name} Copy`;
  scene.add(copy);
  editableObjects.push(copy);
  selectObject(copy);
  refreshUI();
}

function mirrorSelected() {
  if (!selectedObject) return;
  const copy = selectedObject.clone();
  copy.geometry = selectedObject.geometry.clone();
  copy.material = selectedObject.material.clone();
  copy.position.x = -selectedObject.position.x;
  copy.scale.x *= -1;
  copy.name = `${selectedObject.name} Mirrored`;
  scene.add(copy);
  editableObjects.push(copy);
  selectObject(copy);
  refreshUI();
}

function refreshLayerSelects() {
  const selects = [
    document.querySelector("#objectLayer"),
    document.querySelector("#paintLayerSelect")
  ];
  for (const select of selects) {
    const current = select.value;
    select.innerHTML = "";
    for (const layer of layers) {
      const option = document.createElement("option");
      option.value = layer.id;
      option.textContent = layer.name;
      select.appendChild(option);
    }
    if (layers.some(l => l.id === current)) select.value = current;
  }
  document.querySelector("#paintLayerSelect").value = selectedLayerId;
}

function refreshLayersList() {
  const list = document.querySelector("#layersList");
  list.innerHTML = "";
  for (const layer of layers) {
    const row = document.createElement("div");
    row.className = `layer-row ${layer.id === selectedLayerId ? "selected" : ""}`;
    const name = document.createElement("button");
    name.textContent = layer.name;
    name.addEventListener("click", () => {
      selectedLayerId = layer.id;
      document.querySelector("#paintLayerSelect").value = layer.id;
      refreshLayersList();
    });
    const visible = document.createElement("button");
    visible.textContent = layer.visible ? "👁" : "—";
    visible.title = "Toggle visibility";
    visible.addEventListener("click", () => {
      layer.visible = !layer.visible;
      editableObjects.filter(o => o.userData.layerId === layer.id).forEach(o => o.visible = layer.visible);
      refreshLayersList();
    });
    const lock = document.createElement("button");
    lock.textContent = layer.locked ? "🔒" : "🔓";
    lock.title = "Toggle lock";
    lock.addEventListener("click", () => {
      layer.locked = !layer.locked;
      refreshLayersList();
    });
    row.append(name, visible, lock);
    list.appendChild(row);
  }
}

function refreshObjectsList() {
  const list = document.querySelector("#objectsList");
  list.innerHTML = "";
  for (const obj of editableObjects) {
    const row = document.createElement("div");
    row.className = `object-row ${obj === selectedObject ? "selected" : ""}`;
    const btn = document.createElement("button");
    btn.textContent = obj.name;
    btn.addEventListener("click", () => selectObject(obj));
    const layer = document.createElement("span");
    layer.textContent = layers.find(l => l.id === obj.userData.layerId)?.name || "Layer";
    layer.style.fontSize = "11px";
    layer.style.color = "#aab2bd";
    const vis = document.createElement("button");
    vis.textContent = obj.visible ? "👁" : "—";
    vis.addEventListener("click", () => {
      obj.visible = !obj.visible;
      refreshObjectsList();
    });
    row.append(btn, layer, vis);
    list.appendChild(row);
  }
}

function refreshUI() {
  refreshLayerSelects();
  refreshLayersList();
  refreshObjectsList();
}

function addLayer() {
  const name = prompt("Layer name:", `Layer ${layerCounter}`);
  if (!name) return;
  const id = `layer-${Date.now()}-${layerCounter++}`;
  layers.push({ id, name, visible: true, locked: false, textures: {} });
  selectedLayerId = id;
  refreshUI();
}

function renameLayer() {
  const layer = layers.find(l => l.id === selectedLayerId);
  if (!layer) return;
  const name = prompt("New layer name:", layer.name);
  if (name) {
    layer.name = name;
    refreshUI();
  }
}

function deleteLayer() {
  const index = layers.findIndex(l => l.id === selectedLayerId);
  if (index < 0) return;
  if (editableObjects.some(o => o.userData.layerId === selectedLayerId)) {
    alert("This layer still contains model parts. Move or delete them first.");
    return;
  }
  if (layers.length <= 1) return;
  layers.splice(index, 1);
  selectedLayerId = layers[0].id;
  refreshUI();
}

function combineLayerMeshes() {
  const targets = editableObjects.filter(o => o.userData.layerId === selectedLayerId && o.visible);
  if (targets.length < 2) {
    alert("This layer needs at least two visible meshes to combine.");
    return;
  }

  const geometries = targets.map(obj => {
    obj.updateMatrixWorld(true);
    const g = obj.geometry.clone();
    g.applyMatrix4(obj.matrixWorld);
    ensureUv(g);
    return g;
  });

  const merged = mergeGeometries(geometries, false);
  if (!merged) {
    alert("These meshes could not be combined.");
    return;
  }

  targets.forEach(removeObject);
  const layerName = layers.find(l => l.id === selectedLayerId)?.name || "Combined";
  addMesh(merged, `${layerName} Combined`, selectedLayerId);
}

function setTabs(tabName) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelector(`#tab-${tabName}`).classList.add("active");
  document.querySelector("#paintEditorSection").classList.toggle("hidden", tabName !== "paint");
}

function hitTest(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(editableObjects.filter(o => o.visible), true);
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj.parent && !editableObjects.includes(obj)) obj = obj.parent;
  return editableObjects.includes(obj) ? obj : null;
}

renderer.domElement.addEventListener("pointerdown", event => {
  if (transform.dragging) return;
  const obj = hitTest(event);
  if (obj) {
    const layer = layers.find(l => l.id === obj.userData.layerId);
    if (!layer?.locked) selectObject(obj);
  }
});

function canvasSnapshot() {
  return pctx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
}

function pushUndo() {
  undoStack.push(canvasSnapshot());
  if (undoStack.length > 20) undoStack.shift();
  redoStack = [];
}

function resizePaintCanvas(size, preserve = false) {
  let old;
  if (preserve) {
    const temp = document.createElement("canvas");
    temp.width = paintCanvas.width;
    temp.height = paintCanvas.height;
    temp.getContext("2d").drawImage(paintCanvas, 0, 0);
    old = temp;
  }
  paintCanvas.width = size;
  paintCanvas.height = size;
  pctx.clearRect(0, 0, size, size);
  if (old) pctx.drawImage(old, 0, 0, size, size);
}

function currentTextureKey() {
  return `${document.querySelector("#paintLayerSelect").value}:${document.querySelector("#paintChannel").value}`;
}

function saveCurrentCanvasToState() {
  const key = currentTextureKey();
  textureState.set(key, paintCanvas.toDataURL("image/png"));
}

function loadCanvasFromState() {
  const key = currentTextureKey();
  const data = textureState.get(key);
  pctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  if (!data) {
    drawUvGuide();
    return;
  }
  const img = new Image();
  img.onload = () => {
    pctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    pctx.drawImage(img, 0, 0, paintCanvas.width, paintCanvas.height);
    applyCanvasTexture();
  };
  img.src = data;
}

function drawUvGuide() {
  const layerId = document.querySelector("#paintLayerSelect").value;
  const meshes = editableObjects.filter(o => o.userData.layerId === layerId);
  pctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  pctx.save();
  pctx.strokeStyle = "rgba(255,255,255,0.42)";
  pctx.lineWidth = Math.max(1, paintCanvas.width / 700);
  for (const mesh of meshes) {
    ensureUv(mesh.geometry);
    const uv = mesh.geometry.attributes.uv;
    const index = mesh.geometry.index;
    const triangles = index ? index.count / 3 : uv.count / 3;
    for (let t = 0; t < triangles; t++) {
      const ids = index
        ? [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)]
        : [t * 3, t * 3 + 1, t * 3 + 2];
      pctx.beginPath();
      ids.forEach((id, i) => {
        const x = uv.getX(id) * paintCanvas.width;
        const y = (1 - uv.getY(id)) * paintCanvas.height;
        if (i === 0) pctx.moveTo(x, y);
        else pctx.lineTo(x, y);
      });
      pctx.closePath();
      pctx.stroke();
    }
  }
  pctx.restore();
  document.querySelector("#paintStatus").textContent = `${meshes.length} part(s) prepared`;
}

function prepareUv() {
  const layerId = document.querySelector("#paintLayerSelect").value;
  const meshes = editableObjects.filter(o => o.userData.layerId === layerId);
  if (!meshes.length) {
    alert("This layer has no model parts.");
    return;
  }
  meshes.forEach(mesh => {
    ensureUv(mesh.geometry);
    mesh.geometry.attributes.uv.needsUpdate = true;
  });
  drawUvGuide();
  saveCurrentCanvasToState();
  applyCanvasTexture();
  setStatus("Layer prepared for painting");
}

function applyCanvasTexture() {
  const layerId = document.querySelector("#paintLayerSelect").value;
  const channel = document.querySelector("#paintChannel").value;
  saveCurrentCanvasToState();

  const texture = new THREE.CanvasTexture(paintCanvas);
  texture.flipY = false;
  texture.colorSpace = channel === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;

  editableObjects.filter(o => o.userData.layerId === layerId).forEach(mesh => {
    if (!mesh.material || Array.isArray(mesh.material)) mesh.material = materialForObject();
    if (channel === "color") {
      mesh.material.map = texture;
      mesh.material.color.set(0xffffff);
    } else if (channel === "metalness") {
      mesh.material.metalnessMap = texture;
      mesh.material.metalness = 1;
    } else if (channel === "roughness") {
      mesh.material.roughnessMap = texture;
      mesh.material.roughness = 1;
    }
    mesh.material.needsUpdate = true;
  });
}

function paintPoint(event) {
  const rect = paintCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width * paintCanvas.width,
    y: (event.clientY - rect.top) / rect.height * paintCanvas.height
  };
}

function drawStroke(from, to) {
  const size = Number(document.querySelector("#brushSize").value) * paintCanvas.width / 1024;
  pctx.save();
  pctx.lineCap = "round";
  pctx.lineJoin = "round";
  pctx.lineWidth = size;
  if (paintTool === "eraser") {
    pctx.globalCompositeOperation = "destination-out";
    pctx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    pctx.globalCompositeOperation = "source-over";
    const channel = document.querySelector("#paintChannel").value;
    pctx.strokeStyle = channel === "color"
      ? document.querySelector("#brushColor").value
      : document.querySelector("#brushColor").value;
  }
  pctx.beginPath();
  pctx.moveTo(from.x, from.y);
  pctx.lineTo(to.x, to.y);
  pctx.stroke();
  pctx.restore();
}

paintCanvas.addEventListener("pointerdown", event => {
  if (paintTool === "fill") {
    pushUndo();
    const channel = document.querySelector("#paintChannel").value;
    pctx.fillStyle = channel === "color" ? document.querySelector("#brushColor").value : document.querySelector("#brushColor").value;
    pctx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
    applyCanvasTexture();
    return;
  }
  pushUndo();
  painting = true;
  paintCanvas.setPointerCapture(event.pointerId);
  lastPoint = paintPoint(event);
  drawStroke(lastPoint, lastPoint);
  applyCanvasTexture();
});

paintCanvas.addEventListener("pointermove", event => {
  if (!painting) return;
  const point = paintPoint(event);
  drawStroke(lastPoint, point);
  lastPoint = point;
  applyCanvasTexture();
});

paintCanvas.addEventListener("pointerup", () => {
  painting = false;
  lastPoint = null;
  applyCanvasTexture();
});

function undoPaint() {
  if (!undoStack.length) return;
  redoStack.push(canvasSnapshot());
  pctx.putImageData(undoStack.pop(), 0, 0);
  applyCanvasTexture();
}

function redoPaint() {
  if (!redoStack.length) return;
  undoStack.push(canvasSnapshot());
  pctx.putImageData(redoStack.pop(), 0, 0);
  applyCanvasTexture();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCanvas(filename) {
  paintCanvas.toBlob(blob => downloadBlob(blob, filename), "image/png");
}

function exportUvTemplate() {
  const layer = layers.find(l => l.id === document.querySelector("#paintLayerSelect").value);
  drawUvGuide();
  exportCanvas(`${layer?.name || "Layer"}_UV_Template.png`);
}

function importTexture(file) {
  const img = new Image();
  img.onload = () => {
    pushUndo();
    pctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    pctx.drawImage(img, 0, 0, paintCanvas.width, paintCanvas.height);
    applyCanvasTexture();
    setStatus(`${file.name} imported`);
  };
  img.src = URL.createObjectURL(file);
}

async function importModel(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const url = URL.createObjectURL(file);
  try {
    if (ext === "obj") {
      const text = await file.text();
      const obj = new OBJLoader().parse(text);
      obj.traverse(child => {
        if (child.isMesh) {
          child.geometry = child.geometry.clone();
          ensureUv(child.geometry);
          child.material = materialForObject();
          child.userData.layerId = selectedLayerId;
          child.name = child.name || `Imported ${objectCounter++}`;
          scene.add(child);
          editableObjects.push(child);
        }
      });
    } else {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(child => {
        if (child.isMesh) {
          const geom = child.geometry.clone();
          child.updateMatrixWorld(true);
          geom.applyMatrix4(child.matrixWorld);
          ensureUv(geom);
          const mesh = new THREE.Mesh(geom, child.material?.clone?.() || materialForObject());
          mesh.name = child.name || `Imported ${objectCounter++}`;
          mesh.userData.layerId = selectedLayerId;
          scene.add(mesh);
          editableObjects.push(mesh);
        }
      });
    }
    refreshUI();
    if (editableObjects.length) selectObject(editableObjects.at(-1));
    setStatus(`${file.name} imported`);
  } catch (error) {
    console.error(error);
    alert(`Could not import ${file.name}.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cloneForExport(combined) {
  const exportScene = new THREE.Scene();
  const visible = editableObjects.filter(o => o.visible);
  if (!combined) {
    visible.forEach(obj => {
      const copy = obj.clone();
      copy.geometry = obj.geometry.clone();
      copy.material = obj.material.clone();
      copy.name = obj.name;
      exportScene.add(copy);
    });
    return exportScene;
  }

  if (!visible.length) return exportScene;
  const geometries = visible.map(obj => {
    obj.updateMatrixWorld(true);
    const g = obj.geometry.clone();
    g.applyMatrix4(obj.matrixWorld);
    ensureUv(g);
    return g;
  });
  const merged = mergeGeometries(geometries, false);
  if (merged) {
    const mesh = new THREE.Mesh(merged, visible[0].material.clone());
    mesh.name = "Combined Character";
    exportScene.add(mesh);
  }
  return exportScene;
}

function exportGlb(combined) {
  const exporter = new GLTFExporter();
  const target = cloneForExport(combined);
  exporter.parse(
    target,
    result => {
      const blob = new Blob([result], { type: "model/gltf-binary" });
      downloadBlob(blob, combined ? "character_combined.glb" : "character_separate.glb");
    },
    error => {
      console.error(error);
      alert("GLB export failed.");
    },
    { binary: true }
  );
}

function exportObj() {
  const target = cloneForExport(true);
  const text = new OBJExporter().parse(target);
  downloadBlob(new Blob([text], { type: "text/plain" }), "character_combined.obj");
}

function serializeProject() {
  const objects = editableObjects.map(obj => ({
    name: obj.name,
    layerId: obj.userData.layerId,
    geometry: obj.geometry.toJSON(),
    position: obj.position.toArray(),
    rotation: obj.rotation.toArray(),
    scale: obj.scale.toArray(),
    material: {
      color: obj.material.color?.getHex?.() ?? 0xffffff,
      roughness: obj.material.roughness ?? 0.75,
      metalness: obj.material.metalness ?? 0
    }
  }));
  return {
    version: 1,
    layers,
    objects,
    textures: Object.fromEntries(textureState.entries())
  };
}

function saveProject() {
  const blob = new Blob([JSON.stringify(serializeProject())], { type: "application/json" });
  downloadBlob(blob, "stylized-character-project.json");
}

async function loadProject(file) {
  try {
    const data = JSON.parse(await file.text());
    editableObjects.slice().forEach(removeObject);
    layers.splice(0, layers.length, ...(data.layers || []));
    textureState.clear();
    Object.entries(data.textures || {}).forEach(([k, v]) => textureState.set(k, v));
    const loader = new THREE.BufferGeometryLoader();
    for (const item of data.objects || []) {
      const geometry = loader.parse(item.geometry.data || item.geometry);
      const mesh = addMesh(geometry, item.name, item.layerId);
      mesh.name = item.name;
      mesh.position.fromArray(item.position);
      mesh.rotation.fromArray(item.rotation);
      mesh.scale.fromArray(item.scale);
      mesh.material.color.setHex(item.material?.color ?? 0xffffff);
      mesh.material.roughness = item.material?.roughness ?? 0.75;
      mesh.material.metalness = item.material?.metalness ?? 0;
    }
    refreshUI();
    loadCanvasFromState();
    setStatus("Project loaded");
  } catch (error) {
    console.error(error);
    alert("This project file could not be loaded.");
  }
}

function clearProject() {
  editableObjects.slice().forEach(removeObject);
  textureState.clear();
  pctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  refreshUI();
  setStatus("New project");
}

document.querySelectorAll("[data-primitive]").forEach(btn => btn.addEventListener("click", () => addPrimitive(btn.dataset.primitive)));
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => setTabs(btn.dataset.tab)));
document.querySelectorAll(".transform-mode").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".transform-mode").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  transform.setMode(btn.dataset.mode);
}));
document.querySelectorAll(".paint-tool").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".paint-tool").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  paintTool = btn.dataset.tool;
}));

document.querySelector("#duplicateBtn").addEventListener("click", duplicateSelected);
document.querySelector("#deleteBtn").addEventListener("click", () => removeObject(selectedObject));
document.querySelector("#centerBtn").addEventListener("click", () => selectedObject?.position.set(0, 0, 0));
document.querySelector("#mirrorXBtn").addEventListener("click", mirrorSelected);
document.querySelector("#objectName").addEventListener("change", e => {
  if (selectedObject) {
    selectedObject.name = e.target.value || selectedObject.name;
    refreshObjectsList();
  }
});
document.querySelector("#objectLayer").addEventListener("change", e => {
  if (selectedObject) {
    selectedObject.userData.layerId = e.target.value;
    selectedLayerId = e.target.value;
    refreshUI();
  }
});
document.querySelector("#addLayerBtn").addEventListener("click", addLayer);
document.querySelector("#renameLayerBtn").addEventListener("click", renameLayer);
document.querySelector("#deleteLayerBtn").addEventListener("click", deleteLayer);
document.querySelector("#combineLayerBtn").addEventListener("click", combineLayerMeshes);
document.querySelector("#paintLayerSelect").addEventListener("change", e => {
  saveCurrentCanvasToState();
  selectedLayerId = e.target.value;
  loadCanvasFromState();
  refreshLayersList();
});
document.querySelector("#paintChannel").addEventListener("change", () => {
  saveCurrentCanvasToState();
  loadCanvasFromState();
});
document.querySelector("#prepareUvBtn").addEventListener("click", prepareUv);
document.querySelector("#exportUvBtn").addEventListener("click", exportUvTemplate);
document.querySelector("#clearCanvasBtn").addEventListener("click", () => {
  pushUndo();
  pctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  applyCanvasTexture();
});
document.querySelector("#undoPaintBtn").addEventListener("click", undoPaint);
document.querySelector("#redoPaintBtn").addEventListener("click", redoPaint);
document.querySelector("#textureResolution").addEventListener("change", e => {
  resizePaintCanvas(Number(e.target.value), true);
  applyCanvasTexture();
});
document.querySelector("#textureImportInput").addEventListener("change", e => e.target.files[0] && importTexture(e.target.files[0]));
document.querySelector("#modelImportInput").addEventListener("change", e => e.target.files[0] && importModel(e.target.files[0]));
document.querySelector("#exportGlbSeparateBtn").addEventListener("click", () => exportGlb(false));
document.querySelector("#exportGlbCombinedBtn").addEventListener("click", () => exportGlb(true));
document.querySelector("#exportObjBtn").addEventListener("click", exportObj);
document.querySelector("#exportTexturesBtn").addEventListener("click", () => {
  const layer = layers.find(l => l.id === document.querySelector("#paintLayerSelect").value);
  const channel = document.querySelector("#paintChannel").value;
  exportCanvas(`${layer?.name || "Layer"}_${channel}.png`);
});
document.querySelector("#exportAllUvBtn").addEventListener("click", () => {
  alert("For the browser version, export each layer from the Paint tab. The desktop version will support one-click folder export.");
});
document.querySelector("#gridToggle").addEventListener("change", e => grid.visible = e.target.checked);
document.querySelector("#wireframeToggle").addEventListener("change", e => {
  if (selectedObject?.material) selectedObject.material.wireframe = e.target.checked;
});
document.querySelector("#saveProjectBtn").addEventListener("click", saveProject);
document.querySelector("#loadProjectInput").addEventListener("change", e => e.target.files[0] && loadProject(e.target.files[0]));
document.querySelector("#newProjectBtn").addEventListener("click", () => {
  if (confirm("Start a new project? Unsaved changes will be lost.")) clearProject();
});

function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}
animate();

refreshUI();
addMesh(new THREE.CapsuleGeometry(0.55, 1.3, 8, 18), "Body Base", "body").position.y = 1.2;
addMesh(new THREE.SphereGeometry(0.52, 32, 20), "Head Base", "head").position.y = 2.65;
selectObject(editableObjects[0]);
