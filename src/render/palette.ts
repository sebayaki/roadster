import * as THREE from "three";

/**
 * Shared look of the night stunt venue. Colors above 1.0 are HDR values that
 * bloom (the bloom threshold is ~0.8 after tone mapping).
 */
export const PALETTE = {
  /** Night sky / fog. */
  sky: 0x040508,
  fog: 0x07080c,
  /** Dark asphalt of the venue. */
  asphalt: 0x141519,
  /** White painted lines on the asphalt. */
  linePaint: 0xd9dadc,
  /** Light-gray concrete-like riding surface of the Curl. */
  rampSurface: 0xc4c7cb,
  /** Galvanized steel of the truss tower. */
  steel: 0x9aa0a6,
  /** Roadster "Ano White" paint. */
  anoWhite: 0xe9eaec,
  /** Roadster lower body / diffuser. */
  satinBlack: 0x0d0e10,
  /** Roadster "Gold Glazed" glass tint. */
  goldGlass: 0x4a2c18,
  /** Titanium accents. */
  titanium: 0x8b8e92,
} as const;

/** HDR emissive colors (pass to MeshBasicMaterial.color or emissive with intensity 1). */
export const GLOW = {
  /** Bright red for small light bars (the Roadster's tail bar). Long strips tone-map to salmon at this level: use ledStrip. */
  ledRed: new THREE.Color(6.0, 0.22, 0.2),
  /**
   * Core of the venue's red LED strips (runway, barriers, ramp and stage edges).
   * Lands near sRGB (255, 84, 73) under ACES, the red of the photos.
   */
  ledStrip: new THREE.Color(1.6, 0.02, 0.045),
  /** Additive halo around the LED strips. */
  ledHalo: new THREE.Color(0.34, 0.004, 0.008),
  /** White front light bar / floodlight lamps. */
  white: new THREE.Color(5.0, 5.0, 5.2),
  /** Cool cold-gas jet core. */
  jet: new THREE.Color(2.2, 2.6, 3.4),
} as const;
