self.importScripts('https://cdn.babylonjs.com/babylon.max.js');

self.window = {
	addEventListener: function (event, fn, opt) {
		bindHandler('window', event, fn, opt);
	},
	setTimeout: self.setTimeout.bind(self),
	PointerEvent: true,
};

self.document = {
	addEventListener: function (event, fn, opt) {
		bindHandler('document', event, fn, opt);
	},
	// Uses to detect wheel event like at src/Inputs/scene.inputManager.ts:797
	createElement: function () {
		return {onwheel: true};
	},
	defaultView: self.window,
};

// Not works without it
class HTMLElement {}

// Listening events from Main thread
self.onmessage = onMainMessage;

/**
 * All event handlers
 * @type {Map<String, Function>} key as (documentcontextmenu, canvaspointerup...)
 */
self.handlers = new Map();

/**
 * @type {OffscreenCanvas}
 */
self.canvas = null;

// getBoundingInfo()
const rect = {
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	x: 0,
	y: 0,
	height: 0,
	width: 0,
};

function onMainMessage(msg) {

	switch (msg.data.type) {
		case 'event':
			handleEvent(msg.data);
			break;
		case 'resize':
			onResize(msg.data.rect);
			break;
		case 'init':
			init(msg.data);
			break;
	}

}

function init(data) {

	const canvas = prepareCanvas(data);

	runBabylon(canvas);

}

/**
 * Preparing and hooks canvas
 * @param data
 * @returns {OffscreenCanvas}
 */
function prepareCanvas(data) {

	const canvas = data.canvas;
	self.canvas = canvas;

	canvas.clientWidth = data.width;
	canvas.clientHeight = data.height;

	canvas.width = data.width;
	canvas.height = data.height;

	rect.right = rect.width = data.width;
	rect.bottom = rect.height = data.height;

	canvas.setAttribute = function (name, value) {
		postMessage({
			type: 'canvasMethod',
			method: 'setAttribute',
			args: [name, value],
		})
	};

	canvas.addEventListener = function (event, fn, opt) {
		bindHandler('canvas', event, fn, opt);
	};

	canvas.getBoundingClientRect = function () {
		return rect;
	};

	canvas.focus = function () {
		postMessage({
			type: 'canvasMethod',
			method: 'focus',
			args: [],
		})
	};

	// noinspection JSUnusedGlobalSymbols
	const style = {
		set touchAction(value) {
			postMessage({
				type: 'canvasStyle',
				name: 'touchAction',
				value: value,
			})
		}
	};

	Object.defineProperty(canvas, 'style', {get() {return style}});

	return canvas;
}

/**
 * Default playground example
 * @param canvas
 */
function runBabylon(canvas) {

	const engine = new BABYLON.Engine(canvas, true, {
		stencil: true,
		disableWebGL2Support: false,
		audioEngine: false,
	});

	// This creates a basic Babylon Scene object (non-mesh)
	const scene = new BABYLON.Scene(engine);

	// This creates and positions a free camera (non-mesh)
	const camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(0, 5, -10), scene);

	// This targets the camera to scene origin
	camera.setTarget(BABYLON.Vector3.Zero());

	// This attaches the camera to the canvas
	camera.attachControl(canvas, true);

	// This creates a light, aiming 0,1,0 - to the sky (non-mesh)
	const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);

	// Default intensity is 1. Let's dim the light a small amount
	light.intensity = 0.7;

	// Our built-in 'sphere' shape.
	const sphere = BABYLON.MeshBuilder.CreateSphere("sphere", {diameter: 2, segments: 32}, scene);

	// Move the sphere upward 1/2 its height
	sphere.position.y = 1;

	// Our built-in 'ground' shape.
	BABYLON.MeshBuilder.CreateGround("ground", {width: 6, height: 6}, scene);

	engine.runRenderLoop(scene.render.bind(scene));

}

/**
 * addEventListener hooks
 * 1. Store callback in worker
 * 2. Send info to Main thread to bind to DOM elements
 * @param {String} targetName  ['canvas', 'document', 'window']
 * @param {String} eventName
 * @param {Function} fn
 * @param {Boolean} opt third addEventListener argument
 */
function bindHandler(targetName, eventName, fn, opt) {

	const handlerId = targetName + eventName;

	handlers.set(handlerId, fn);

	postMessage({
		type: 'event',
		targetName: targetName,
		eventName: eventName,
		opt: opt,
	})
}

/**
 * Events from Main thread call this handler which calls right callback saved earlier
 * @param event
 */
function handleEvent(event) {

	const handlerId = event.targetName + event.eventName;

	event.eventClone.preventDefault = noop;

	// Cameras/Inputs/freeCameraMouseInput.ts:79
	event.eventClone.target = self.canvas;

	// Just in case
	if (!handlers.has(handlerId)) {
		throw new Error('Unknown handlerId: ' + handlerId);
	}

	handlers.get(handlerId)(event.eventClone);

}

function onResize(originalRect) {

	for (let prop of Object.keys(rect)) {
		rect[prop] = originalRect[prop];
	}

	self.canvas.clientWidth = rect.width;
	self.canvas.clientHeight = rect.height;

	self.canvas.width = rect.width;
	self.canvas.height = rect.height;

}

function noop() {}

