import type MapBrowserEvent from "ol/MapBrowserEvent";
import Draw from "ol/interaction/Draw";
import DragPan from "ol/interaction/DragPan";

export const isMiddleButtonEvent = (event: Event): boolean => {
  if (!("button" in event)) return false;
  const pointer = event as MouseEvent;
  return pointer.button === 1 || (pointer.buttons & 4) !== 0;
};

export const isRightButtonEvent = (event: Event): boolean => {
  if (!("button" in event)) return false;
  const pointer = event as MouseEvent;
  return pointer.button === 2 || (pointer.buttons & 2) !== 0;
};

export const isPanButtonEvent = (event: Event): boolean => isMiddleButtonEvent(event) || isRightButtonEvent(event);

export class MiddleButtonDragPan extends DragPan {
  constructor() {
    super({ condition: ({ originalEvent }) => isPanButtonEvent(originalEvent) });
    this.stopDown = (handled) => handled;
  }
}

export class MiddleButtonSafeDraw extends Draw {
  override handleEvent(event: MapBrowserEvent<PointerEvent>): boolean {
    if (isPanButtonEvent(event.originalEvent)) return true;
    return super.handleEvent(event);
  }
}
