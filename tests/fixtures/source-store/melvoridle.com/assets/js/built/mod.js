class ModContext {
  constructor(name) {
    this.name = name;
    this.characterStorage = {};
    this.accountStorage = {};
    this.settings = {};
  }

  getContext(meta) {
    return this;
  }

  loadModule(path) {
    return import(path);
  }

  api(endpoints) {
    mod.api[this.name] = endpoints;
  }

  onCharacterLoaded(callback) {
    game.on('characterLoaded', callback);
  }

  onInterfaceReady(callback) {
    game.on('interfaceReady', callback);
  }
}

function patch(targetClass, methodName) {
  const patcher = {
    before(fn) { return fn; },
    after(fn) { return fn; },
    replace(fn) { return fn; },
  };
  return patcher;
}

function isPatched(targetClass, methodName) {
  return false;
}

class OfflineProgressElement extends HTMLElement {
  connectedCallback() {}
  setMessages(game, oldSnapshot, newSnapshot, timeDiff, offlineAction) {}
}

class OfflineLoadingElement extends HTMLElement {
  updateProgress(timeProcessed, totalTime, tps) {}
}

customElements.define('offline-progress', OfflineProgressElement);
customElements.define('offline-loading', OfflineLoadingElement);
