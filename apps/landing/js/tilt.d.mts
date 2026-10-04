export interface Tilt {
  x: number;
  y: number;
}
export const MAX_TILT_X: number;
export const MAX_TILT_Y: number;
export const TILT_PER_PIXEL: number;
export const RETURN_SECONDS: number;
export const REST_EPSILON: number;
export function clamp(value: number, min: number, max: number): number;
export function tiltFromDrag(start: Tilt, dx: number, dy: number, options?: { yOnly?: boolean }): Tilt;
export function decayTilt(tilt: Tilt, dt: number): Tilt;
export function isAtRest(tilt: Tilt): boolean;
