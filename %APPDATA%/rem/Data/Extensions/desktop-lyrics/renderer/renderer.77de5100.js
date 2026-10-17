process.env.HMR_PORT=0;process.env.HMR_HOSTNAME="localhost";// modules are defined as an array
// [ module function, map of requires ]
//
// map of requires is short require name -> numeric require
//
// anything defined in a previous bundle is accessed via the
// orig method which is the require for previous bundles
parcelRequire = (function (modules, cache, entry, globalName) {
  // Save the require from previous bundle to this closure if any
  var previousRequire = typeof parcelRequire === 'function' && parcelRequire;
  var nodeRequire = typeof require === 'function' && require;

  function newRequire(name, jumped) {
    if (!cache[name]) {
      if (!modules[name]) {
        // if we cannot find the module within our internal map or
        // cache jump to the current global require ie. the last bundle
        // that was added to the page.
        var currentRequire = typeof parcelRequire === 'function' && parcelRequire;
        if (!jumped && currentRequire) {
          return currentRequire(name, true);
        }

        // If there are other bundles on this page the require from the
        // previous one is saved to 'previousRequire'. Repeat this as
        // many times as there are bundles until the module is found or
        // we exhaust the require chain.
        if (previousRequire) {
          return previousRequire(name, true);
        }

        // Try the node require function if it exists.
        if (nodeRequire && typeof name === 'string') {
          return nodeRequire(name);
        }

        var err = new Error('Cannot find module \'' + name + '\'');
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }

      localRequire.resolve = resolve;
      localRequire.cache = {};

      var module = cache[name] = new newRequire.Module(name);

      modules[name][0].call(module.exports, localRequire, module, module.exports, this);
    }

    return cache[name].exports;

    function localRequire(x){
      return newRequire(localRequire.resolve(x));
    }

    function resolve(x){
      return modules[name][1][x] || x;
    }
  }

  function Module(moduleName) {
    this.id = moduleName;
    this.bundle = newRequire;
    this.exports = {};
  }

  newRequire.isParcelRequire = true;
  newRequire.Module = Module;
  newRequire.modules = modules;
  newRequire.cache = cache;
  newRequire.parent = previousRequire;
  newRequire.register = function (id, exports) {
    modules[id] = [function (require, module) {
      module.exports = exports;
    }, {}];
  };

  var error;
  for (var i = 0; i < entry.length; i++) {
    try {
      newRequire(entry[i]);
    } catch (e) {
      // Save first error but execute all entries
      if (!error) {
        error = e;
      }
    }
  }

  if (entry.length) {
    // Expose entry point to Node, AMD or browser globals
    // Based on https://github.com/ForbesLindesay/umd/blob/master/template.js
    var mainExports = newRequire(entry[entry.length - 1]);

    // CommonJS
    if (typeof exports === "object" && typeof module !== "undefined") {
      module.exports = mainExports;

    // RequireJS
    } else if (typeof define === "function" && define.amd) {
     define(function () {
       return mainExports;
     });

    // <script>
    } else if (globalName) {
      this[globalName] = mainExports;
    }
  }

  // Override the current require with this new one
  parcelRequire = newRequire;

  if (error) {
    // throw error from earlier, _after updating parcelRequire_
    throw error;
  }

  return newRequire;
})({"index.ts":[function(require,module,exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const { subscribe, connect } = window;
const player = connect('player-controller');
const lyricServer = connect('lyric');
const settings = connect('settings');
let lrc;
let romalrc;
let tlrc;
async function loadLyrics() {
    const audioData = await player.invoke('.audioData');
    const { lrc: l, romalrc: r, tlrc: t } = await lyricServer.invoke(audioData.id + '');
    lrc = parseLrc(l?.lyric);
    romalrc = parseLrc(r?.lyric);
    tlrc = parseLrc(t?.lyric);
}
function getLineIndex(lrc, time) {
    const lrclen = lrc.length;
    if (time >= lrc.at(-1).time) {
        return [lrclen - 1];
    }
    for (let i = 1; i < lrclen; i++) {
        const cur = lrc[i];
        if (cur.time > time) {
            return [i - 1, i];
        }
    }
    return [lrclen - 2, lrclen - 1];
}
function parseLrc(lrcstr) {
    if (!lrcstr) {
        return null;
    }
    return lrcstr.split('\n').map(line => {
        const [time, lyric] = line.split(']');
        if (!time || !lyric) {
            return {
                time: 0,
                lyric: ''
            };
        }
        const [_, m, s, rad] = /(\d+):(\d+)\.(\d+)/g.exec(time.slice(1));
        return {
            time: Number(s) * 1000 + Number(m) * 60 * 1000 + Number(rad),
            lyric
        };
    }).filter(line => line.lyric.trim());
}
const lineTop = document.getElementById('top');
const lineBottom = document.getElementById('bottom');
const setLock = lock();
async function renderLines(time) {
    if (!lrc)
        return;
    const [l1, l2] = getLineIndex(lrc, time);
    let current, next;
    if (lrc && l1 % 2) {
        current = lineBottom;
        next = lineTop;
    }
    else {
        current = lineTop;
        next = lineBottom;
    }
    current.classList.add('focus');
    next.classList.remove('focus');
    current.innerText = lrc[l1].lyric;
    next.innerText = l2 ? lrc[l2].lyric : ' ';
    const { colorCurrent, colorNext, fontSize, lock } = JSON.parse(await settings.invoke('["get"]'));
    current.style.color = colorCurrent;
    next.style.color = colorNext;
    current.style.fontSize = fontSize;
    next.style.fontSize = fontSize;
    if (setLock(lock)) {
        document.body.classList[!lock ? 'add' : 'remove']('unlock');
    }
}
function lock() {
    let lockState = true;
    return (newState) => {
        if (newState !== lockState) {
            electron_1.ipcRenderer.invoke('desktop-lyrics-lock', lockState = newState);
            return true;
        }
        return false;
    };
}
subscribe('player', loadLyrics);
subscribe('playstate', ([, , , current]) => {
    renderLines(current * 1000);
});
loadLyrics();

},{}]},{},["index.ts"], null)