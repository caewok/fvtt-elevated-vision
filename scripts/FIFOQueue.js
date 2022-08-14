/* globals

*/
"use strict";

// FIFO queue.
// Used by ElevationLayerToolBar to store undo history
export class FIFOQueue {
  constructor(max = 50) {
    this.elements = [];
  }

  get length() {
    return this.elements.length;
  }

  enqueue(element) {
    this.elements.push(element);
    if ( this.elements.length > 50 ) this.elements.shift();
  }

  dequeue() {
    return this.elements.pop();
  }

  peek() {
    return this.elements[this.length - 1];
  }
}