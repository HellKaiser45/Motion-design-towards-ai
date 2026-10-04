/**
 * @module agent-stage/bridges/anchor-bridge
 * World-anchored SVG overlay: an overlay SVG element tracks a 3D world point
 * every stage tick. The target's world position is projected through the
 * stage camera into NDC, converted to overlay pixel coords, and applied as a
 * CSS transform on the mounted SVG. Hidden (opacity 0) when behind the camera
 * or off-screen.
 */

import * as THREE from 'three';

const _v = new THREE.Vector3(); // reused per frame

export class AnchorBridge {
  /** @param {{stage:object, threeLayer:object, svgLayer:object}} deps */
  constructor({ stage, threeLayer, svgLayer }) {
    if (!stage || !svgLayer) {
      throw new Error('[agent-stage.anchorBridge] requires { stage, svgLayer }');
    }
    this._stage = stage;
    this._threeLayer = threeLayer;
    this._svgLayer = svgLayer;
    /** @private Map<string, {svg, target, offset, anchor}> */
    this._anchors = new Map();
    this._onTick = () => this.updateAll();
    stage.on('tick', this._onTick);
  }

  /**
   * Anchor a mounted SVG to a 3D target.
   * @param {string} svgName mounted SVG name
   * @param {{target: string|object, offset?: {x:number,y:number,z:number},
   *          anchor?: 'top'|'center'|'bottom'}} opts
   *        target: three-layer name or a THREE.Object3D
   */
  anchor(svgName, opts = {}) {
    const svg = this._svgLayer.get(svgName);
    if (!svg) throw new Error(`[agent-stage.anchorBridge] unknown svg "${svgName}"`);
    let target = opts.target;
    if (typeof target === 'string') {
      target = this._threeLayer?.get(target);
      if (!target) throw new Error(`[agent-stage.anchorBridge] unknown target object "${opts.target}"`);
    }
    if (!target || typeof target.getWorldPosition !== 'function') {
      throw new Error('[agent-stage.anchorBridge] anchor() requires a target Object3D or name');
    }
    const o = opts.offset ?? { x: 0, y: 0, z: 0 };
    const offset = { x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0 };
    const anchor = opts.anchor ?? 'center';
    this._anchors.set(svgName, { svg, target, offset, anchor });
    svg.style.transformOrigin = '0 0';
    svg.style.willChange = 'transform';
    this.updateAll();
    return this;
  }

  /** @param {string} svgName */
  detach(svgName) {
    const a = this._anchors.get(svgName);
    if (!a) return false;
    a.svg.style.transform = '';
    a.svg.style.opacity = '';
    this._anchors.delete(svgName);
    return true;
  }

  /** Reposition every anchor. Called automatically on each stage tick. */
  updateAll() {
    if (!this._anchors.size) return;
    const overlay = this._svgLayer._overlay;
    const W = overlay.clientWidth || 1;
    const H = overlay.clientHeight || 1;
    const cam = this._stage.camera;
    cam.updateMatrixWorld();

    for (const { svg, target, offset, anchor } of this._anchors.values()) {
      const v = target.getWorldPosition(_v);
      v.x += offset.x; v.y += offset.y; v.z += offset.z;
      v.project(cam);

      // behind camera (projected z > 1) or off-screen -> hide
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) {
        svg.style.opacity = '0';
        continue;
      }
      const px = (v.x * 0.5 + 0.5) * W;
      const py = (-v.y * 0.5 + 0.5) * H;
      const w = svg.clientWidth || parseFloat(svg.style.width) || 0;
      const h = svg.clientHeight || parseFloat(svg.style.height) || 0;
      let dx = px - w / 2;
      let dy = py;
      if (anchor === 'center') dy = py - h / 2;
      else if (anchor === 'bottom') dy = py - h;
      svg.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
      svg.style.opacity = '1';
    }
  }

  dispose() {
    this._stage.off('tick', this._onTick);
    for (const name of [...this._anchors.keys()]) this.detach(name);
  }
}
