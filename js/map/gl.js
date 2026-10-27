// Обёртка над WebGL2: шейдеры, буферы, сетки. Три программы: заливка, линии, здания.

const FILL_VS = `#version 300 es
uniform mat4 u_matrix;
uniform float u_z;
in vec2 a_pos;
void main() { gl_Position = u_matrix * vec4(a_pos, u_z, 1.0); }`;

const FILL_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o_color;
void main() { o_color = u_color; }`;

// Линия: вершина смещается на нормаль × (полуширина в пикселях × метров на пиксель).
const LINE_VS = `#version 300 es
uniform mat4 u_matrix;
uniform float u_halfw;
uniform float u_z;
in vec2 a_pos;
in vec2 a_off;
in float a_dist;
out float v_dist;
void main() {
  v_dist = a_dist;
  gl_Position = u_matrix * vec4(a_pos + a_off * u_halfw, u_z, 1.0);
}`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
uniform float u_dash;   // период пунктира в пикселях, 0 — сплошная
uniform float u_mpp;
in float v_dist;
out vec4 o_color;
void main() {
  if (u_dash > 0.0 && mod(v_dist / u_mpp, u_dash) > u_dash * 0.55) discard;
  o_color = u_color;
}`;

const BUILDING_VS = `#version 300 es
uniform mat4 u_matrix;
uniform float u_hscale;
in vec3 a_pos;
in float a_shade;
out float v_shade;
void main() {
  v_shade = a_shade;
  gl_Position = u_matrix * vec4(a_pos.xy, a_pos.z * u_hscale, 1.0);
}`;

const BUILDING_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
uniform vec4 u_wall;
in float v_shade;
out vec4 o_color;
void main() {
  vec3 base = v_shade > 0.99 ? u_color.rgb : u_wall.rgb * v_shade;
  o_color = vec4(base, u_color.a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs, attribs, uniforms) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
  return { p, u };
}

export function createPrograms(gl) {
  return {
    fill: program(gl, FILL_VS, FILL_FS, ['a_pos'], ['u_matrix', 'u_z', 'u_color']),
    line: program(gl, LINE_VS, LINE_FS, ['a_pos', 'a_off', 'a_dist'], ['u_matrix', 'u_halfw', 'u_z', 'u_color', 'u_dash', 'u_mpp']),
    building: program(gl, BUILDING_VS, BUILDING_FS, ['a_pos', 'a_shade'], ['u_matrix', 'u_hscale', 'u_color', 'u_wall'])
  };
}

/**
 * Сетка: вершины Float32Array, индексы Uint32Array, раскладка атрибутов [[размер], ...] (в float).
 * Возвращает { vao, count, lineVao?, lineCount? } — для зданий отдельно индексы контуров (gl.LINES).
 */
export function createMesh(gl, vertices, indices, layout, lineIndices = null) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const stride = layout.reduce((s, n) => s + n, 0) * 4;
  let off = 0;
  layout.forEach((n, i) => {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, n, gl.FLOAT, false, stride, off);
    off += n * 4;
  });
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const mesh = { vao, vbo, ibo, count: indices.length };
  if (lineIndices && lineIndices.length) {
    const lvao = gl.createVertexArray();
    gl.bindVertexArray(lvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    layout.forEach((n, i) => {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, n, gl.FLOAT, false, stride, layout.slice(0, i).reduce((s, k) => s + k, 0) * 4);
    });
    const libo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, libo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIndices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    mesh.lineVao = lvao; mesh.libo = libo; mesh.lineCount = lineIndices.length;
  }
  return mesh;
}

export function deleteMesh(gl, mesh) {
  if (!mesh) return;
  gl.deleteVertexArray(mesh.vao);
  gl.deleteBuffer(mesh.vbo);
  gl.deleteBuffer(mesh.ibo);
  if (mesh.lineVao) { gl.deleteVertexArray(mesh.lineVao); gl.deleteBuffer(mesh.libo); }
}

/** '#RRGGBB' или '#RRGGBBAA' → [r, g, b, a] в 0..1. */
export function rgba(hex, alpha = 1) {
  const h = hex.replace('#', '');
  const v = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [v(0), v(2), v(4), h.length >= 8 ? v(6) * alpha : alpha];
}
