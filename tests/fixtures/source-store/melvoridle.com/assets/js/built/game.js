class Game {
  constructor() {
    this.enableRendering = true;
  }

  enterOfflineLoop(loopTime) {
    this.emit('offlineLoopEntered', loopTime);
    globalThis.loadingOfflineProgress = true;
  }

  exitOfflineLoop(loopTime) {
    this.emit('offlineLoopExited', loopTime);
    globalThis.loadingOfflineProgress = false;
  }

  render() {
    if (!this.enableRendering) return;
    this.renderQueue.process();
  }
}
