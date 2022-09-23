const title = document.getElementById('title');
const buttonContainer = document.getElementById('button-container');
const slider = document.getElementById('slider');
const sliderDisplay = document.getElementById('slider-display');
const infoButton = document.getElementById('info-button');
const infoOverlay = document.getElementById('info-overlay');
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioContext = null;

const defaultEffectParams = {
  lowpass: {
    minCutoffFreq: 100,
    maxCutoffFreq: 20000,
  },
  resampling: {
    maxCent: 1200,
    autoReset: true
  }
};

const crossFadeTime = 0.050;
const fadeOutTime = 0.1;

let setup = null;
let effect = null;
let audioOutput = null;
let sounds = null;

let currentSoundIndex = null;
let loopStartTime = 0;

// effect 'lowpass'
let lowpass = null;
let minCutoffFreq = 0;
let maxCutoffFreq = 0;
let logCutoffRatio = 0;

// effect 'resampling'
let resamplingFactor = 0;
let maxCentResampling = 0;
let autoResetResampling = false;

let analyser = null;
let analyserArray = null;

main();

infoButton.addEventListener('click', (evt) => {
  infoOverlay.classList.add('show');
  evt.stopPropagation();

}, false);

infoOverlay.addEventListener('click', () => infoOverlay.classList.remove('show'));

async function main() {
  const response = await fetch('./setup.json');
  setup = await response.json();

  makeMenu(setup);
}

/***************************************************************************/

class Sound {
  constructor(index, button, loop = false, level = 0) {
    this.index = index;
    this.button = button;
    this.loop = loop;
    this.amp = decibelToLinear(level);
    this.buffer = null;
    this.gain = null;
    this.source = null;

    if (loop) {
      button.classList.add('looping');
    }

    this.onEnded = this.onEnded.bind(this);
  }

  setBuffer(buffer) {
    this.buffer = buffer;
    this.button.classList.remove('disabled');
  }

  setResampling(factor) {
    this.source.playbackRate.value = centToLinear(maxCentResampling * factor);
  }

  start(time, syncPhase = false) {
    const buffer = this.buffer;
    let offset = 0;

    const gain = audioContext.createGain();
    gain.connect(audioOutput);
    gain.connect(analyser);

    if (syncPhase) {
      // fade in only when starting somewhere in the middle
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(this.amp, time + crossFadeTime);

      // set offset to loop time
      offset = (time - loopStartTime) % buffer.duration;
    } else {
      gain.gain.value = this.amp;
      loopStartTime = time;
    }

    const source = audioContext.createBufferSource();
    source.connect(gain);
    source.buffer = buffer;
    source.loop = true;
    source.start(time, offset);

    this.source = source;
    this.gain = gain;

    this.setResampling(resamplingFactor);

    if (!this.loop) {
      this.button.classList.add('looping');
    }

    source.addEventListener('ended', this.onEnded);

    this.button.classList.add('playing');
    this.button.classList.add('active');
    currentSoundIndex = this.index;
  }

  stop(time, fadeTime = fadeOutTime) {
    this.source.stop(time + fadeTime);
    this.gain.gain.setValueAtTime(this.amp, time);
    this.gain.gain.linearRampToValueAtTime(0, time + fadeTime);

    this.reset();
  }

  reset() {
    this.release();
    this.source.removeEventListener('ended', this.onEnded);

    if (currentSoundIndex === this.index) {
      currentSoundIndex = null;
      resetEffect();
    }

    this.source = null;
    this.gain = null;

    this.button.classList.remove('playing');
  }

  release() {
    // release loop for non-loops
    if (!this.loop) {
      this.source.loop = false;
      this.button.classList.remove('looping');
    }

    this.button.classList.remove('active');
  }

  continue() {
    // continue loop for non-loops
    if (!this.loop) {
      this.source.loop = true;
      this.button.classList.add('looping');
    }

    this.button.classList.add('active');
  }

  onEnded() {
    this.reset();
  }

  get isReady() {
    return (this.buffer !== null);
  }

  get isPlaying() {
    return (this.source !== null);
  }
}

function makeButton(container, data, index, label, eventHandler) {
  const button = document.createElement('div');

  button.classList.add('button');
  button.innerHTML = label;
  button.dataset[data] = index;

  if (eventHandler) {
    button.addEventListener('click', eventHandler, false);
  }

  buttonContainer.appendChild(button);

  return button;
}

function makeMenu(menuList) {
  title.innerText = 'Sammlungen';
  buttonContainer.classList = 'menu';

  slider.classList.add('hide');

  for (let i = 0; i < menuList.length; i++) {
    const button = makeButton(buttonContainer, 'item', i, menuList[i].name, onMenuButtonClick);
    button.classList.add('menu');
  }
}

function makePlayer(collection) {
  title.innerText = collection.name;
  buttonContainer.classList = 'player';

  slider.classList.remove('hide'); // show slider

  initEffect(collection.params);

  const soundList = collection.sounds;
  sounds = [];

  for (let i = 0; i < soundList.length; i++) {
    const soundDescr = soundList[i];

    const button = makeButton(buttonContainer, 'sound', i, soundList[i].name);
    button.classList.add('player');
    button.classList.add('disabled');

    const sound = new Sound(i, button, soundDescr.loop, soundDescr.level);
    sounds.push(sound);

    loadSound(sound, soundDescr.filename);
  }

  buttonContainer.addEventListener('mousedown', onMouseDown);
  buttonContainer.addEventListener('mousemove', onMouseMove);
  buttonContainer.addEventListener('mouseup', onMouseUp);
  buttonContainer.addEventListener('touchstart', onTouchStart, { passive: false });
  buttonContainer.addEventListener('touchmove', onTouchMove, { passive: false });
  buttonContainer.addEventListener('touchend', onTouchEnd, { passive: false });
  buttonContainer.addEventListener('touchcancel', onTouchEnd, { passive: false });
}

async function loadSound(sound, filename) {
  const response = await fetch(filename);
  const arraybuffer = await response.arrayBuffer();

  audioContext.decodeAudioData(arraybuffer, (buffer) => {
    sound.setBuffer(buffer);
  });
}

function onMenuButtonClick(evt) {
  const button = evt.target;
  const index = button.dataset.item;

  if (index !== undefined) {
    initAudio();
    buttonContainer.innerHTML = "";

    const collection = setup[index];
    effect = collection.effect || 'none';

    makePlayer(collection);
  }

  evt.stopPropagation();
}

let mouseIsDown = false;

function onMouseDown(evt) {
  const x = evt.clientX;
  const y = evt.clientY;
  startPointer(evt, x, y);

  mouseIsDown = true;
}

function onMouseMove(evt) {
  if (mouseIsDown) {
    const x = evt.clientX;
    const y = evt.clientY;
    movePointer(evt, x, y);
  }
}

function onMouseUp(evt) {
  if (mouseIsDown) {
    endPointer(evt);
    mouseIsDown = false;
  }
}

let touchId = null;
let pendingStop = false;

function onTouchStart(evt) {
  for (let touch of evt.changedTouches) {
    if (touchId === null) {
      const x = touch.clientX;
      const y = touch.clientY;

      touchId = touch.identifier;
      startPointer(evt, x, y);
      break;
    }
  }

  evt.preventDefault();
}

function onTouchMove(evt) {
  for (let touch of evt.changedTouches) {
    if (touch.identifier === touchId) {
      const x = touch.clientX;
      const y = touch.clientY;

      movePointer(evt, x, y);
      break;
    }
  }

  evt.preventDefault();
}

function onTouchEnd(evt) {
  for (let touch of evt.changedTouches) {
    if (touch.identifier === touchId) {
      endPointer(evt);
      touchId = null;
      break;
    }
  }

  evt.preventDefault();
}

let onlySlider = false;
let startX = 0;
let startY = 0;

function startPointer(evt, x, y) {
  const element = document.elementFromPoint(x, y);
  const indexStr = element.dataset.sound;

  startX = x;
  startY = y;

  if (indexStr !== undefined) {
    const index = parseInt(indexStr);

    if (index !== currentSoundIndex) {
      if (currentSoundIndex === null) {
        startSound(index);
      } else {
        transitSound(currentSoundIndex, index);
      }

      pendingStop = false;
      setTimeout(() => {
        pendingStop = true;
      }, 400);
    } else {
      pendingStop = true;
      continueSound(currentSoundIndex);
    }

    onlySlider = false;
  } else {
    onlySlider = true;
  }

  startSlider(x);
}

function movePointer(evt, x, y) {
  const element = document.elementFromPoint(x, y);

  if (element) {
    const indexStr = element.dataset.sound;

    if (indexStr !== undefined) {
      const nextSoundindex = parseInt(indexStr);

      if (nextSoundindex !== currentSoundIndex) {
        if (currentSoundIndex === null) {
          startSound(nextSoundindex);
        } else {
          transitSound(currentSoundIndex, nextSoundindex);
        }
      }

      onlySlider = false;

      const dx = x - startX;
      const dy = y - startY;
      if (dx * dx + dy * dy > 400) {
        pendingStop = true;
      }

      continueSound(currentSoundIndex);
    } else if (currentSoundIndex !== null) {
      releaseSound(currentSoundIndex);
    }
  }

  moveSlider(x);
}

function endPointer() {
  if (currentSoundIndex !== null) {
    if (!onlySlider) {
      if (pendingStop) {
        stopSound(currentSoundIndex);
        resetEffect();
      } else {
        releaseSound(currentSoundIndex);
      }
    }
  }
}

let sliderValue = 0;
let sliderStartX = 0;
let sliderStartValue = 0;
let sliderScale = 0;
let slideWidth = 0;

function startSlider(x) {
  const slideRect = slider.getBoundingClientRect();
  slideWidth = slideRect.width;
  sliderStartX = x;

  if (sliderValue <= 0.05) {
    sliderValue = sliderStartValue = 0.05;
    sliderScale = 1 / (slideWidth - sliderStartX);
  } else if (sliderValue >= 1) {
    sliderValue = sliderStartValue = 1;
    sliderScale = sliderValue / sliderStartX;
  } else {
    const posSliderScale = (1 - sliderValue) / (slideWidth - sliderStartX);
    const negSliderScale = sliderValue / sliderStartX;
    sliderScale = Math.max(posSliderScale, negSliderScale);
    sliderStartValue = sliderValue;
  }
}

function moveSlider(x) {
  sliderValue = sliderStartValue + sliderScale * (x - sliderStartX);

  if (sliderValue <= 0.05) {
    sliderValue = sliderStartValue = 0.05;
    sliderStartX = x;
    sliderScale = 1 / (slideWidth - sliderStartX);
  } else if (sliderValue >= 1) {
    sliderValue = sliderStartValue = 1;
    sliderStartX = x;
    sliderScale = sliderValue / sliderStartX;
  }

  setEffect(sliderValue);
}

function initAudio() {
  if (audioContext === null) {
    audioContext = new AudioContext();
    audioOutput = audioContext.destination;

    analyser = audioContext.createAnalyser();
    analyserArray = new Float32Array(analyser.fftSize);
  }
}

function initEffect(params = defaultEffectParams[effect]) {
  const defaultParams = defaultEffectParams[effect];

  switch (effect) {
    case 'lowpass': {
      minCutoffFreq = (params.minCutoffFreq || defaultParams.minCutoffFreq);
      maxCutoffFreq = (params.maxCutoffFreq || defaultParams.maxCutoffFreq);
      logCutoffRatio = Math.log(params.maxCutoffFreq / params.minCutoffFreq);

      lowpass = audioContext.createBiquadFilter();
      lowpass.connect(audioContext.destination);
      lowpass.type = 'lowpass';
      lowpass.Q.value = 0;
      audioOutput = lowpass

      sliderValue = 0.75;
      setEffect(0.75);
      break;
    }

    case 'resampling': {
      maxCentResampling = params.maxCent || defaultEffectParams.maxCent;
      autoResetResampling = params.autoReset || defaultEffectParams.autoReset;

      sliderValue = 0.5;
      setEffect(0.5);
      break;
    }

    default:
      break;
  }
}

function setEffect(value) {
  sliderDisplay.style.width = `${100 * value}%`;

  switch (effect) {
    case 'lowpass':
      lowpass.frequency.value = minCutoffFreq * Math.exp(logCutoffRatio * value);
      break;

    case 'resampling':
      resamplingFactor = 0;

      if (value > 0.6) {
        resamplingFactor = Math.min(1, 2.5 * (value - 0.6));
      } else if (value < 0.4) {
        resamplingFactor = Math.max(-1, 2.5 * value - 1);
      }

      if (currentSoundIndex !== null) {
        sounds[currentSoundIndex].setResampling(resamplingFactor);
      }
      break;

    default:
      break;
  }
}

function resetEffect() {
  switch (effect) {
    case 'lowpass':
      break;

    case 'resampling':
      if (autoResetResampling) {
        sliderValue = 0.5;
        setEffect(0.5);
      }
      break;

    default:
      break;

  }
}

function startSound(index) {
  const sound = sounds[index];

  if (sound.isReady) {
    const time = audioContext.currentTime;
    sounds[index].start(time);
  }

  // displayIntensity();
}

function stopSound(index) {
  const time = audioContext.currentTime;
  sounds[index].stop(time);
}

function transitSound(currentIndex, nextIndex) {
  const time = audioContext.currentTime;
  const currentSound = sounds[currentIndex];
  const nextSound = sounds[nextIndex];
  let syncPhase = false;
  let stopTime = fadeOutTime;

  if (currentSound.loop && nextSound.loop) {
    stopTime = crossFadeTime;
    syncPhase = true;
  }

  currentSound.stop(time, stopTime);

  if (nextSound.isReady) {
    nextSound.start(time, syncPhase);
  }
}

function releaseSound(index) {
  sounds[index].release();
}

function continueSound(index) {
  sounds[index].continue();
}

function displayIntensity() {
  if (analyser.getFloatTimeDomainData) {
    const fftSize = analyser.fftSize;

    analyser.getFloatTimeDomainData(analyserArray);

    let sum = 0;
    for (let i = 0; i < fftSize; i++) {
      const value = analyserArray[i];
      sum += (value * value);
    }

    const light = 255 * Math.min(1, 0.25 + 10 * Math.sqrt(sum / fftSize));
    document.body.style.backgroundColor = `rgb(${light}, ${light}, ${light})`;
  }

  if (currentSoundIndex !== null) {
    window.requestAnimationFrame(displayIntensity);
  } else {
    document.body.style.backgroundColor = 'black';
  }
}

function decibelToLinear(val) {
  return Math.exp(0.11512925464970229 * val); // pow(10, val / 20)
}

function centToLinear(val) {
  return Math.exp(0.0005776226504666211 * val); // pow(2, val / 1200)
};
