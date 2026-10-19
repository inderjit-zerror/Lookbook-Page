"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { garmentFragment, garmentVertex } from "./shaders";

const MAX_LAYERS = 64;
const noRaycast = () => {};

function createMesh(fabric, viewport) {
  const { n } = fabric;
  const geo = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  fabric.writeVertices(position.array);
  geo.setAttribute("position", position);

  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uv[i * 2] = fabric.u[i];
    uv[i * 2 + 1] = 1 - fabric.v[i];
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(Uint16Array.from(fabric.triangles), 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: garmentVertex,
    fragmentShader: garmentFragment,
    uniforms: {
      uMap: { value: fabric.asset.texture },
      uViewport: viewport,
      uLayer: { value: 0 },
      uLayers: { value: MAX_LAYERS },
    },
    side: THREE.DoubleSide,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.raycast = noRaycast;
  mesh.userData.version = fabric.version;
  return mesh;
}

/**
 * Renders the playground's garments and steps the simulation every frame.
 * `onFrame` runs after each step (used for the pickup hint).
 */
export default function GarmentLayer({ playground, onFrame }) {
  const { size } = useThree();
  const group = useRef(null);
  const meshes = useRef(new Map());
  const viewport = useRef({ value: new THREE.Vector2(1, 1) });

  useEffect(() => {
    viewport.current.value.set(size.width, size.height);
  }, [size]);

  useEffect(() => {
    const map = meshes.current;
    const g = group.current;
    return () => {
      for (const mesh of map.values()) {
        g?.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      map.clear();
    };
  }, []);

  useFrame((_, delta) => {
    const pg = playground.current;
    if (!pg || !group.current) return;
    pg.update(delta * 1000);

    const map = meshes.current;
    const live = new Set(pg.fabrics);
    for (const [fabric, mesh] of map) {
      if (live.has(fabric)) continue;
      group.current.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      map.delete(fabric);
    }

    pg.fabrics.forEach((fabric, order) => {
      let mesh = map.get(fabric);
      if (!mesh) {
        mesh = createMesh(fabric, viewport.current);
        map.set(fabric, mesh);
        group.current.add(mesh);
      } else if (mesh.userData.version !== fabric.version) {
        const attr = mesh.geometry.attributes.position;
        fabric.writeVertices(attr.array);
        attr.needsUpdate = true;
        mesh.userData.version = fabric.version;
      }
      const layer = Math.min(order, MAX_LAYERS - 1);
      mesh.material.uniforms.uLayer.value = layer;
      mesh.renderOrder = layer;
    });

    onFrame?.(performance.now());
  });

  return <group ref={group} />;
}
