/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Point {
  x: number;
  y: number;
}

export interface DrawingAction {
  points: Point[];
  color: string;
  brushSize: number;
  type: 'free' | 'rect';
}

export type StatusMode = 'none' | 'draw' | 'pause' | 'clear' | 'hover';

export interface AppState {
  selColor: number;
  selBrush: number;
  status: StatusMode;
  mode: 'free' | 'shape';
  isAiEnabled: boolean;
}
