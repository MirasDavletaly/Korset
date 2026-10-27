// Отрисовка карты через WebGL2 по слоям.
import { createPrograms, createMesh, deleteMesh, rgba } from './gl.js';
import { buildAreaMeshes, buildRoadMeshes, buildLineArrays, buildBuildingMesh, buildSingleBuilding } from './meshes.js';
import { roadWidth, casingWidth, DASHED, ROAD_ORDER, AREA_ORDER, WATERWAY_WIDTH, stopWidth } from './style.js';

const LINE_LAYOUT = [2, 2, 1];
const BUILDING_LAYOUT = [3, 1];

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 недоступен');
    this.gl = gl;
    this.canvas = canvas;
    this.prog = createPrograms(gl);
    this.areas = {}; this.roads = {}; this.waterways = {}; this.rail = null; this.tram = null;
    this.buildings = null; this.parts = null; this.withParts = null;
    this.route = []; this.selected = null;
  }

  setBase(store) {
    const gl = this.gl;
    for (const [cls, m] of Object.entries(buildAreaMeshes(store.areas))) this.areas[cls] = createMesh(gl, m.vertices, m.indices, [2]);
    for (const [key, m] of Object.entries(buildRoadMeshes(store.roads))) this.roads[key] = createMesh(gl, m.vertices, m.indices, LINE_LAYOUT);
    const byCls = {};
    for (const l of store.lines) (byCls[l.cls] = byCls[l.cls] || []).push(l.pts);
    for (const [cls, list] of Object.entries(byCls)) {
      const m = buildLineArrays(list);
      if (cls === 'rail') this.rail = createMesh(gl, m.vertices, m.indices, LINE_LAYOUT);
      else if (cls === 'tram') this.tram = createMesh(gl, m.vertices, m.indices, LINE_LAYOUT);
      else this.waterways[cls] = createMesh(gl, m.vertices, m.indices, LINE_LAYOUT);
    }
  }

  setBuildings(store) {
    const gl = this.gl;
    const main = buildBuildingMesh(store.buildings, b => !(b.flags & 1) && !(b.flags & 2));
    const parts = buildBuildingMesh(store.buildings, b => !!(b.flags & 1));
    const withParts = buildBuildingMesh(store.buildings, b => !!(b.flags & 2));
    this.buildings = createMesh(gl, main.vertices, main.indices, BUILDING_LAYOUT, main.lineIndices);
    this.parts = parts.indices.length ? createMesh(gl, parts.vertices, parts.indices, BUILDING_LAYOUT, parts.lineIndices) : null;
    this.withParts = withParts.indices.length ? createMesh(gl, withParts.vertices, withParts.indices, BUILDING_LAYOUT, withParts.lineIndices) : null;
  }

  /** routes: [{ coords: Float32Array [x,y,...], primary, mode }] */
  setRoute(routes) {
    const gl = this.gl;
    for (const r of this.route) deleteMesh(gl, r.mesh);
    this.route = routes.map(r => {
      const m = buildLineArrays([r.coords]);
      return { primary: r.primary, mode: r.mode, mesh: createMesh(gl, m.vertices, m.indices, LINE_LAYOUT) };
    });
  }

  setSelectedBuilding(b) {
    deleteMesh(this.gl, this.selected);
    this.selected = null;
    if (!b) return;
    const m = buildSingleBuilding(b);
    this.selected = createMesh(this.gl, m.vertices, m.indices, BUILDING_LAYOUT, m.lineIndices);
  }

  resize(w, h, dpr) {
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
  }

  render(cam, pal, { hscale = 0, is3D = false } = {}) {
    const gl = this.gl, P = this.prog;
    const z = cam.zoom, mpp = cam.mpp;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const land = rgba(pal.land);
    gl.clearColor(land[0], land[1], land[2], 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // площади
    gl.useProgram(P.fill.p);
    gl.uniformMatrix4fv(P.fill.u.u_matrix, false, cam.matrix32);
    gl.uniform1f(P.fill.u.u_z, 0);
    for (const cls of AREA_ORDER) {
      const m = this.areas[cls];
      if (!m) continue;
      if (cls === 'parking' && z < 14) continue;
      gl.uniform4fv(P.fill.u.u_color, rgba(pal.areas[cls]));
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    }

    // линии: реки, дороги, железная дорога
    gl.useProgram(P.line.p);
    gl.uniformMatrix4fv(P.line.u.u_matrix, false, cam.matrix32);
    gl.uniform1f(P.line.u.u_z, 0);
    gl.uniform1f(P.line.u.u_mpp, mpp);
    const drawLine = (mesh, widthPx, color, dash = 0) => {
      if (!mesh || widthPx <= 0) return;
      gl.uniform1f(P.line.u.u_halfw, (widthPx / 2) * mpp);
      gl.uniform4fv(P.line.u.u_color, color);
      gl.uniform1f(P.line.u.u_dash, dash);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    };
    const waterColor = rgba(pal.water);
    for (const [cls, mesh] of Object.entries(this.waterways)) drawLine(mesh, stopWidth(WATERWAY_WIDTH[cls] || WATERWAY_WIDTH.ditch, z), waterColor);

    const roadPass = (suffix) => {
      for (const cls of ROAD_ORDER) {
        const w = roadWidth(cls, z), c = casingWidth(cls, w);
        if (w > 0 && c > 0) drawLine(this.roads[`${cls}:${suffix}`], w + 2 * c, rgba(pal.roads.casing[cls]));
      }
      for (const cls of ROAD_ORDER) {
        const w = roadWidth(cls, z);
        drawLine(this.roads[`${cls}:${suffix}`], w, rgba(pal.roads.fill[cls]), DASHED.has(cls) ? Math.max(4, w * 3.2) : 0);
      }
    };
    roadPass('n');
    roadPass('b');
    if (z >= 11) {
      const rw = z < 14 ? 1.2 : 2;
      drawLine(this.rail, rw + 1, rgba(pal.rail));
      if (z >= 14) drawLine(this.rail, rw - 0.6, rgba(pal.railDash), 10);
      drawLine(this.tram, z < 15 ? 0.8 : 1.4, rgba(pal.rail, 0.8));
    }

    // маршрут: в 3D — до зданий, чтобы дома его загораживали
    if (is3D) this.drawRoute(cam, pal, true);

    // здания
    if (this.buildings && z >= 12.5) {
      const alpha = Math.min(1, (z - 12.5) / 1.2);
      gl.useProgram(P.building.p);
      gl.uniformMatrix4fv(P.building.u.u_matrix, false, cam.matrix32);
      gl.uniform1f(P.building.u.u_hscale, hscale);
      if (hscale > 0.001) {
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
      }
      gl.uniform4fv(P.building.u.u_color, rgba(hscale > 0.001 ? pal.buildingRoof : pal.building, alpha));
      gl.uniform4fv(P.building.u.u_wall, rgba(pal.buildingWall));
      const meshes = [this.buildings, hscale > 0.5 ? this.parts : this.withParts];
      for (const m of meshes) if (m) { gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); }
      if (hscale < 0.02 && z >= 15) {
        gl.uniform4fv(P.building.u.u_color, rgba(pal.buildingOutline, alpha));
        for (const m of meshes) if (m && m.lineVao) { gl.bindVertexArray(m.lineVao); gl.drawElements(gl.LINES, m.lineCount, gl.UNSIGNED_INT, 0); }
      }
      // выбранное здание
      if (this.selected) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(-2, -2);
        gl.uniform4fv(P.building.u.u_color, rgba(pal.route, 0.28));
        gl.uniform4fv(P.building.u.u_wall, rgba(pal.route, 0.28));
        gl.bindVertexArray(this.selected.vao);
        gl.drawElements(gl.TRIANGLES, this.selected.count, gl.UNSIGNED_INT, 0);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.uniform4fv(P.building.u.u_color, rgba(pal.route, 1));
        if (this.selected.lineVao) { gl.bindVertexArray(this.selected.lineVao); gl.drawElements(gl.LINES, this.selected.lineCount, gl.UNSIGNED_INT, 0); }
      }
      gl.disable(gl.DEPTH_TEST);
    }

    if (!is3D) this.drawRoute(cam, pal, false);
    gl.bindVertexArray(null);
  }

  drawRoute(cam, pal, depth) {
    if (!this.route.length) return;
    const gl = this.gl, P = this.prog, mpp = cam.mpp;
    gl.useProgram(P.line.p);
    gl.uniformMatrix4fv(P.line.u.u_matrix, false, cam.matrix32);
    gl.uniform1f(P.line.u.u_mpp, mpp);
    gl.uniform1f(P.line.u.u_z, 0.3);
    if (depth) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); }
    const w = Math.max(4, Math.min(11, roadWidth(2, cam.zoom) * 0.55 + 3));
    const pass = (r, width, color, dash) => {
      gl.uniform1f(P.line.u.u_halfw, (width / 2) * mpp);
      gl.uniform4fv(P.line.u.u_color, color);
      gl.uniform1f(P.line.u.u_dash, dash);
      gl.bindVertexArray(r.mesh.vao);
      gl.drawElements(gl.TRIANGLES, r.mesh.count, gl.UNSIGNED_INT, 0);
    };
    const alts = this.route.filter(r => !r.primary), main = this.route.filter(r => r.primary);
    for (const r of alts) pass(r, w + 3, rgba(pal.routeAltCasing), 0);
    for (const r of alts) pass(r, w, rgba(pal.routeAlt), 0);
    for (const r of main) pass(r, w + 4, rgba(pal.routeCasing), 0);
    for (const r of main) pass(r, w, rgba(pal.route), r.mode === 'foot' ? w * 2.2 : 0);
    if (depth) gl.disable(gl.DEPTH_TEST);
  }
}
