// Chrome-only: MV3 service workers have no DOM, so thumbnail HTML parsing
// runs in an offscreen document. Firefox packages omit this file and instead
// load offscreen.js via background.scripts (event page has DOM).

'use strict';

let creatingOffscreen; // avoid concurrent createDocument races

function offscreenApiAvailable() {
	return typeof chrome.offscreen?.createDocument === 'function';
}

async function setupOffscreenDocument(path) {
	// Missing permission (or Firefox) leaves chrome.offscreen undefined.
	// createDocument would throw "reading 'createDocument'" and drop the screenshot.
	if (!offscreenApiAvailable()) {
		return false;
	}

	const offscreenUrl = chrome.runtime.getURL(path);
	const existingContexts = await chrome.runtime.getContexts({
		contextTypes: ['OFFSCREEN_DOCUMENT'],
		documentUrls: [offscreenUrl]
	});

	if (existingContexts.length > 0) {
		return true;
	}

	if (creatingOffscreen) {
		try {
			await creatingOffscreen;
		} catch (err) {
			console.log('Failed to create offscreen document:', err?.message || err);
		}
	}

	const contextsAfterWait = await chrome.runtime.getContexts({
		contextTypes: ['OFFSCREEN_DOCUMENT'],
		documentUrls: [offscreenUrl]
	});
	if (contextsAfterWait.length > 0) {
		return true;
	}

	try {
		creatingOffscreen = chrome.offscreen.createDocument({
			url: path,
			reasons: [chrome.offscreen.Reason.DOM_PARSER],
			justification: 'parse document for image tags to use as thumbnail'
		});
		await creatingOffscreen;
		return true;
	} catch (err) {
		const message = err?.message || String(err);
		// A document created by a previous wake is still valid; keep using it.
		if (/single offscreen document/i.test(message)) {
			return true;
		}
		console.log('Failed to create offscreen document:', message);
		return false;
	} finally {
		creatingOffscreen = null;
	}
}

async function processThumbnailsViaOffscreen(payload, onFailure) {
	const ready = await setupOffscreenDocument('offscreen.html');
	if (!ready) {
		return false;
	}

	try {
		// Do not await offscreen completion — its async listener would hold this
		// call open, and awaiting a round-trip saveThumbnails message can deadlock MV3.
		chrome.runtime.sendMessage({
			target: 'offscreen',
			data: payload
		}).catch((err) => {
			console.log('Failed to message offscreen document:', err?.message || err);
			if (typeof onFailure === 'function') {
				onFailure();
			}
		});
	} catch (err) {
		console.log('Failed to message offscreen document:', err?.message || err);
		return false;
	}
	return true;
}
