/*******************************************
 * Reference for worker event capture from 
 * https://xcraft.net/tutorial/lab/babylon_worker/init.js
 * 
 *********************************************/


(function () {
	'use strict';

	const canvas = document.getElementById('babylon-canvas');

	const worker = new Worker('worker.js');

	// Events props to send to worker
	const mouseEventFields = new Set([
		'altKey',
		'bubbles',
		'button',
		'buttons',
		'cancelBubble',
		'cancelable',
		'clientX',
		'clientY',
		'composed',
		'ctrlKey',
		'defaultPrevented',
		'detail',
		'eventPhase',
		'fromElement',
		'isTrusted',
		'layerX',
		'layerY',
		'metaKey',
		'movementX',
		'movementY',
		'offsetX',
		'offsetY',
		'pageX',
		'pageY',
		'relatedTarget',
		'returnValue',
		'screenX',
		'screenY',
		'shiftKey',
		'timeStamp',
		'type',
		'which',
		'x',
		'y',
		'deltaX',
		'deltaY',
		'deltaZ',
		'deltaMode',
	]);

	init();

	function init() {

		worker.onmessage = workerToMain;

		const offscreenCanvas = canvas.transferControlToOffscreen();

		window.addEventListener('resize', onResize, false);

		worker.postMessage({
			type: 'init',
			width: canvas.clientWidth,
			height: canvas.clientHeight,
			canvas: offscreenCanvas,
		}, [offscreenCanvas]);
	}

	function workerToMain(msg) {

		switch (msg.data.type) {
			case 'event':
				bindEvent(msg.data);
				break;
			case 'canvasMethod':
				canvas[msg.data.method](...msg.data.args);
				break;
			case 'canvasStyle':
				canvas.style[msg.data.name] = msg.data.value;
				break;
		}
	}

	/**
	 * Bind DOM element
	 * @param data
	 */
	function bindEvent(data) {

		let target;

		switch (data.targetName) {
			case 'window':
				target = window;
				break;
			case 'canvas':
				target = canvas;
				break;
			case 'document':
				target = document;
				break;
		}

		if (!target) {
			return;
		}


		target.addEventListener(data.eventName, function (e) {

			// We can`t pass original event to the worker
			const eventClone = cloneEvent(e);

			worker.postMessage({
				type: 'event',
				targetName: data.targetName,
				eventName: data.eventName,
				eventClone: eventClone,
			});

		}, data.opt);

	}

	/**
	 * Cloning Event to plain object
	 * @param event
	 */
	function cloneEvent(event) {

		event.preventDefault();

		const eventClone = {};

		for (let field of mouseEventFields) {
			eventClone[field] = event[field];
		}

		return eventClone;
	}

	function onResize() {
		worker.postMessage({
			type: 'resize',
			rect: canvas.getBoundingClientRect(),
		});
	}


})();
