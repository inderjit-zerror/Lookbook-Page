// Shaders live in JS strings so they work with both webpack and Turbopack builds.

// Vertices arrive already projected to screen pixels (x, y-down) plus a small
// local depth. Every garment owns its own slice of the depth buffer (uLayer),
// so a later / picked-up garment always sits on top while its own folds still
// sort correctly against each other.
export const garmentVertex = /* glsl */ `
  uniform vec2 uViewport;
  uniform float uLayer;
  uniform float uLayers;

  varying vec2 vUv;

  void main() {
    vUv = uv;
    float slice = 2.0 / (uLayers + 1.0);
    float depth = 1.0 - (uLayer + 1.0) * slice + clamp(position.z, -0.45, 0.45) * slice;
    gl_Position = vec4(
      position.x / uViewport.x * 2.0 - 1.0,
      1.0 - position.y / uViewport.y * 2.0,
      depth,
      1.0
    );
  }
`;

// Unlit: the garment artwork is shown exactly as photographed.
export const garmentFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;

  void main() {
    vec4 color = texture2D(uMap, vUv);
    if (color.a < 0.02) discard;
    gl_FragColor = color;
    #include <colorspace_fragment>
  }
`;
