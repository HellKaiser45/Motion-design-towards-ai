/**
 * @module agent-stage (public entry)
 * The ONLY import point for consumers. Exports the full public API and a
 * convenience factory `createAgentStage` that constructs and wires everything.
 */
import * as THREE from 'three';
import { Stage } from './core/stage.js';
import { Timeline } from './core/timeline.js';
import { EventEmitter, createEmitter } from './core/events.js';
import { easings, applyEasing } from './core/easing.js';
import { ThreeLayer } from './layers/three-layer.js';
import { SvgLayer } from './layers/svg-layer.js';
import { PropEngine } from './engines/prop-engine.js';
import { WaapiEngine } from './engines/waapi-engine.js';
import { SmilEngine } from './engines/smil-engine.js';
import { AnchorBridge } from './bridges/anchor-bridge.js';
import { TextureBridge } from './bridges/texture-bridge.js';
import { compile as compilePack, normalizePack, CompiledPack } from './driver/pack-compiler.js';
import { Registry } from './driver/registry.js';
import { AgentDriver } from './driver/agent-driver.js';
import { Compositor } from './export/compositor.js';
import { FrameRenderer } from './export/frame-renderer.js';
import { ExportManager } from './export/export-manager.js';
import { WebmRecorder } from './export/backends/webm-recorder.js';
import { PngSequence } from './export/backends/png-sequence.js';
import { Mp4Encoder } from './export/backends/mp4-encoder.js';

/**
 * Construct and wire a full Agent Stage aggregate. Nothing is mounted yet —
 * register assets/packs on the registry and call instantiate()/compileAll().
 * @param {{mount: Element|string,
 *          stageOptions?: object}} [opts]
 * @returns {{stage: Stage, timeline: Timeline, threeLayer: ThreeLayer,
 *            svgLayer: SvgLayer, engines: {prop:PropEngine, waapi:WaapiEngine, smil:SmilEngine},
 *            registry: Registry, driver: AgentDriver,
 *            anchorBridge: AnchorBridge, textureBridge: TextureBridge,
 *            ctx: object}}
 */
function createAgentStage(opts = {}) {
  if (!opts || !opts.mount) {
    throw new Error('[agent-stage] createAgentStage() requires { mount }');
  }
  const stage = new Stage(opts.mount, opts.stageOptions);
  const threeLayer = new ThreeLayer();
  const svgLayer = new SvgLayer(stage.svgOverlay);
  const engines = {
    prop: new PropEngine(threeLayer),
    waapi: new WaapiEngine(svgLayer),
    smil: new SmilEngine(svgLayer),
  };
  const timeline = new Timeline({
    stage,
    propEngine: engines.prop,
    waapiEngine: engines.waapi,
    smilEngine: engines.smil,
    svgLayer,
    threeLayer,
  });

  const ctx = {
    threeLayer,
    svgLayer,
    propEngine: engines.prop,
    waapiEngine: engines.waapi,
    smilEngine: engines.smil,
  };

  const registry = new Registry({ svgLayer, threeLayer });
  registry.setContext(ctx);
  const driver = new AgentDriver({ stage, timeline, registry, ctx });
  const anchorBridge = new AnchorBridge({ stage, threeLayer, svgLayer });
  const textureBridge = new TextureBridge({ stage, svgLayer, three: THREE });

  return {
    stage, timeline, threeLayer, svgLayer, engines, ctx,
    registry, driver, anchorBridge, textureBridge,
  };
}

export {
  Stage,
  Timeline,
  ThreeLayer,
  SvgLayer,
  PropEngine,
  WaapiEngine,
  SmilEngine,
  AnchorBridge,
  TextureBridge,
  compilePack as compile,
  normalizePack,
  CompiledPack,
  Registry,
  AgentDriver,
  EventEmitter,
  createEmitter,
  easings,
  applyEasing,
  Compositor,
  FrameRenderer,
  ExportManager,
  WebmRecorder,
  PngSequence,
  Mp4Encoder,
  createAgentStage,
};
