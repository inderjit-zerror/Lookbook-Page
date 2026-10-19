"use client";
import { PerspectiveCamera } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";
import ScreenMesher from "./ScreenMesher";


const BgCanvas = () => {
  const distance = 200;
  const [fov, setFov] = useState(75);

  const FovCalculator = () => {
    setFov(2 * Math.atan(window.innerHeight / 2 / distance) * (180 / Math.PI));
  };

  useEffect(() => {
    FovCalculator();
    window.addEventListener("resize", FovCalculator);
    return () => window.removeEventListener("resize", FovCalculator);
  }, []);

  return (
    <div className="w-full h-screen fixed top-0 left-0 z-[-1] max-sm:hidden">
      <Canvas className="w-full h-full ">
        <PerspectiveCamera makeDefault fov={fov} position={[0, 0, distance]} />
        <ScreenMesher />
      </Canvas>
    </div>
  );
};

export default BgCanvas
