import type { ReactNode, RefObject } from "react";
import { DragEvent, ResizeEvent } from "@interactjs/types/index";

type EventData = {
  lastLeft: number;
  left: number;
  lastWidth: number;
  width: number;
};

export type RndDragStartCallback = (e: DragEvent) => void;
export type RndDragCallback = (
  data: EventData,
  scrollDelta?: number,
) => boolean | void;

/** Fires on every pointer move during drag (includes vertical-only moves). */
export type RndDragVerticalTickCallback = (data: {
  left: number;
  width: number;
  deltaY: number;
}) => void;
export type RndDragEndCallback = (
  data: Pick<EventData, "left" | "width"> & { deltaY?: number },
) => void;

export type Direction = "left" | "right";
export type RndResizeStartCallback = (dir: Direction) => void;
export type RndResizeCallback = (
  dir: Direction,
  data: EventData
) => boolean | void;
export type RndResizeEndCallback = (
  dir: Direction,
  data: Pick<EventData, "left" | "width">
) => void;

export interface RowRndApi {
  updateWidth: (size: number) => void;
  updateLeft: (left: number) => void;
  getLeft: () => number;
  getWidth: () => number;
}

export interface RowRndProps {
  width?: number;
  left?: number;
  grid?: number;
  start?: number;
  bounds?: { left: number; right: number };
  edges?: { left: boolean | string; right: boolean | string };

  onResizeStart?: RndResizeStartCallback;
  onResize?: RndResizeCallback;
  onResizeEnd?: RndResizeEndCallback;
  onDragStart?: RndDragStartCallback;
  onDrag?: RndDragCallback;
  /** Called on every drag pointer move so consumers can react to deltaY without horizontal grid steps. */
  onDragVerticalTick?: RndDragVerticalTickCallback;
  onDragEnd?: RndDragEndCallback;
  parentRef: RefObject<HTMLDivElement>;
  deltaScrollLeft?: (delta: number) => void;

  children?: ReactNode;

  enableResizing?: boolean;
  enableDragging?: boolean;
  adsorptionPositions?: number[];
  adsorptionDistance?: number;
}
