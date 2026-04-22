const https = require('https');
const net = require('net');
const tls = require('tls');

const REQUEST_TIMEOUT_MS = 30000;

/**
 * Build a fetch-like headers object from node response headers
 * @param {Record<string, string|string[]|undefined>} headers - response headers
 * @returns {{get: Function}} - fetch-like headers interface
 */
function buildHeaders(headers) {
	return {
		get(name) {
			const value = headers[name.toLowerCase()];
			if(Array.isArray(value)) {
				return value.join(', ');
			}

			return value ?? null;
		}
	};
}

/**
 * Build a fetch-like response object
 * @param {import('http').IncomingMessage} response - node response
 * @param {Buffer} bodyBuffer - response body
 * @returns {{ok: boolean, status: number, headers: {get: Function}, text: Function, json: Function}}
 */
function buildResponse(response, bodyBuffer) {
	return {
		ok: response.statusCode >= 200 && response.statusCode < 300,
		status: response.statusCode || 0,
		headers: buildHeaders(response.headers),
		text: async () => bodyBuffer.toString('utf8'),
		json: async () => JSON.parse(bodyBuffer.toString('utf8'))
	};
}

/**
 * Strip a port from a NO_PROXY entry
 * @param {string} value - raw no_proxy entry
 * @returns {string} normalized host
 */
function stripNoProxyPort(value) {
	if(value.startsWith('[')) {
		const closingIndex = value.indexOf(']');
		return closingIndex === -1 ? value : value.slice(1, closingIndex);
	}

	const colonCount = [...value].filter(char => char === ':').length;
	if(colonCount === 1) {
		return value.split(':')[0];
	}

	return value;
}

/**
 * Check if a hostname should bypass the configured proxy
 * @param {string} hostname - request hostname
 * @param {string} noProxyValue - NO_PROXY env value
 * @returns {boolean} whether the hostname should bypass the proxy
 */
function shouldBypassProxy(hostname, noProxyValue) {
	if(!noProxyValue) {
		return false;
	}

	const normalizedHostname = hostname.toLowerCase();

	return noProxyValue
		.split(',')
		.map(value => stripNoProxyPort(value.trim().toLowerCase()))
		.filter(Boolean)
		.some(entry => {
			if(entry === '*') {
				return true;
			}

			if(entry.startsWith('.')) {
				return normalizedHostname.endsWith(entry);
			}

			return normalizedHostname === entry || normalizedHostname.endsWith(`.${entry}`);
		});
}

/**
 * Resolve a proxy from explicit options or environment variables
 * @param {URL} targetUrl - request target url
 * @param {string|false|undefined} explicitProxy - explicit proxy override
 * @returns {URL|null} parsed proxy URL
 */
function resolveProxy(targetUrl, explicitProxy) {
	if(explicitProxy === false) {
		return null;
	}

	if(!explicitProxy) {
		const noProxy = process.env.NO_PROXY || process.env.no_proxy;
		if(shouldBypassProxy(targetUrl.hostname, noProxy)) {
			return null;
		}
	}

	const proxyValue =
		typeof explicitProxy === 'string' && explicitProxy.trim()
			? explicitProxy.trim()
			: process.env.HTTPS_PROXY ||
				process.env.https_proxy ||
				process.env.ALL_PROXY ||
				process.env.all_proxy ||
				process.env.HTTP_PROXY ||
				process.env.http_proxy;

	if(!proxyValue) {
		return null;
	}

	const proxyUrl = new URL(proxyValue);
	if(!['http:', 'https:'].includes(proxyUrl.protocol)) {
		throw new Error(`Unsupported proxy protocol "${proxyUrl.protocol}". Only http:// and https:// proxies are supported.`);
	}

	return proxyUrl;
}

/**
 * Wait until a socket fires the ready event or times out
 * @param {import('net').Socket|import('tls').TLSSocket} socket - socket instance
 * @param {string} eventName - ready event name
 * @param {number} timeoutMs - timeout in milliseconds
 * @param {string} label - human-friendly label for errors
 * @returns {Promise<void>}
 */
function waitForSocketReady(socket, eventName, timeoutMs, label) {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			socket.setTimeout(0);
			socket.off(eventName, onReady);
			socket.off('error', onError);
			socket.off('timeout', onTimeout);
		};

		const onReady = () => {
			cleanup();
			resolve();
		};

		const onError = (error) => {
			cleanup();
			socket.destroy();
			reject(error);
		};

		const onTimeout = () => {
			cleanup();
			socket.destroy();
			reject(new Error(`${label} timed out after ${timeoutMs}ms`));
		};

		socket.once(eventName, onReady);
		socket.once('error', onError);
		socket.once('timeout', onTimeout);
		socket.setTimeout(timeoutMs);
	});
}

/**
 * Build CONNECT authority for a host
 * @param {URL} targetUrl - request target url
 * @returns {string} authority string
 */
function getConnectAuthority(targetUrl) {
	const hostname = targetUrl.hostname.includes(':')
		? `[${targetUrl.hostname}]`
		: targetUrl.hostname;

	return `${hostname}:${targetUrl.port || 443}`;
}

/**
 * Create the Proxy-Authorization header when credentials are present
 * @param {URL} proxyUrl - proxy URL
 * @returns {string} header line or empty string
 */
function buildProxyAuthorization(proxyUrl) {
	if(!proxyUrl.username && !proxyUrl.password) {
		return '';
	}

	const username = decodeURIComponent(proxyUrl.username);
	const password = decodeURIComponent(proxyUrl.password);
	const credentials = Buffer.from(`${username}:${password}`).toString('base64');

	return `Proxy-Authorization: Basic ${credentials}\r\n`;
}

/**
 * Read the HTTP CONNECT response from the proxy
 * @param {import('net').Socket|import('tls').TLSSocket} socket - connected proxy socket
 * @param {number} timeoutMs - timeout in milliseconds
 * @returns {Promise<void>}
 */
function readProxyConnectResponse(socket, timeoutMs) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let bufferLength = 0;

		const cleanup = () => {
			socket.setTimeout(0);
			socket.off('data', onData);
			socket.off('error', onError);
			socket.off('end', onEnd);
			socket.off('timeout', onTimeout);
		};

		const fail = (error) => {
			cleanup();
			socket.destroy();
			reject(error);
		};

		const onData = (chunk) => {
			chunks.push(chunk);
			bufferLength += chunk.length;

			const buffer = Buffer.concat(chunks, bufferLength);
			const headerEndIndex = buffer.indexOf('\r\n\r\n');
			if(headerEndIndex === -1) {
				return;
			}

			const headerText = buffer.subarray(0, headerEndIndex).toString('utf8');
			const statusLine = headerText.split('\r\n')[0];
			const statusMatch = statusLine.match(/^HTTP\/1\.[01] (\d{3})/);

			if(!statusMatch) {
				return fail(new Error(`Invalid proxy CONNECT response: ${statusLine}`));
			}

			const statusCode = Number(statusMatch[1]);
			if(statusCode !== 200) {
				return fail(new Error(`Proxy CONNECT failed with status ${statusCode}`));
			}

			const remainder = buffer.subarray(headerEndIndex + 4);
			cleanup();
			if(remainder.length) {
				socket.unshift(remainder);
			}
			resolve();
		};

		const onError = (error) => {
			cleanup();
			reject(error);
		};

		const onEnd = () => {
			fail(new Error('Proxy closed the tunnel before CONNECT completed'));
		};

		const onTimeout = () => {
			fail(new Error(`Proxy CONNECT timed out after ${timeoutMs}ms`));
		};

		socket.on('data', onData);
		socket.once('error', onError);
		socket.once('end', onEnd);
		socket.once('timeout', onTimeout);
		socket.setTimeout(timeoutMs);
	});
}

/**
 * Create a TLS socket to the target through an HTTP(S) proxy
 * @param {URL} targetUrl - request target url
 * @param {URL} proxyUrl - parsed proxy URL
 * @param {number} timeoutMs - timeout in milliseconds
 * @returns {Promise<import('tls').TLSSocket>} tunneled socket
 */
async function createProxyTunnel(targetUrl, proxyUrl, timeoutMs) {
	const proxyPort = Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80);
	const proxySocket = proxyUrl.protocol === 'https:'
		? tls.connect({
			host: proxyUrl.hostname,
			port: proxyPort,
			servername: proxyUrl.hostname
		})
		: net.connect({
			host: proxyUrl.hostname,
			port: proxyPort
		});

	await waitForSocketReady(
		proxySocket,
		proxyUrl.protocol === 'https:' ? 'secureConnect' : 'connect',
		timeoutMs,
		`Connection to proxy ${proxyUrl.host}`
	);

	const authority = getConnectAuthority(targetUrl);
	const connectRequest =
		`CONNECT ${authority} HTTP/1.1\r\n` +
		`Host: ${authority}\r\n` +
		buildProxyAuthorization(proxyUrl) +
		'Proxy-Connection: Keep-Alive\r\n' +
		'\r\n';

	proxySocket.write(connectRequest);
	await readProxyConnectResponse(proxySocket, timeoutMs);

	const targetSocket = tls.connect({
		socket: proxySocket,
		servername: targetUrl.hostname
	});

	await waitForSocketReady(
		targetSocket,
		'secureConnect',
		timeoutMs,
		`TLS handshake to ${targetUrl.host}`
	);

	return targetSocket;
}

/**
 * Make an HTTPS request with optional proxy support
 * @param {string} url - request url
 * @param {object} [options] - request options
 * @param {string} [options.method='GET'] - HTTP method
 * @param {object} [options.headers={}] - request headers
 * @param {string|Buffer} [options.body] - request body
 * @param {string|false} [options.proxy] - explicit proxy URL, or false to disable env proxies
 * @param {number} [options.timeoutMs=30000] - request timeout in milliseconds
 * @returns {Promise<{ok: boolean, status: number, headers: {get: Function}, text: Function, json: Function}>}
 */
async function request(url, options = {}) {
	const targetUrl = new URL(url);
	if(targetUrl.protocol !== 'https:') {
		throw new Error(`Unsupported request protocol "${targetUrl.protocol}". Only https:// URLs are supported.`);
	}

	const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
	const proxyUrl = resolveProxy(targetUrl, options.proxy);
	const headers = { ...(options.headers || {}) };
	const body = options.body;

	if(body != null && headers['Content-Length'] == null && headers['content-length'] == null) {
		headers['Content-Length'] = Buffer.byteLength(body);
	}

	const requestOptions = {
		hostname: targetUrl.hostname,
		port: Number(targetUrl.port) || 443,
		path: `${targetUrl.pathname}${targetUrl.search}`,
		method: options.method || 'GET',
		headers,
		agent: undefined,
		createConnection: undefined
	};

	if(proxyUrl) {
		const tunneledSocket = await createProxyTunnel(targetUrl, proxyUrl, timeoutMs);
		requestOptions.agent = false;
		requestOptions.createConnection = () => tunneledSocket;
	}

	return await new Promise((resolve, reject) => {
		const req = https.request(requestOptions, (response) => {
			const chunks = [];

			response.on('data', chunk => {
				chunks.push(chunk);
			});

			response.once('error', reject);
			response.once('end', () => {
				resolve(buildResponse(response, Buffer.concat(chunks)));
			});
		});

		req.once('error', reject);
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error(`Request to ${targetUrl.origin} timed out after ${timeoutMs}ms`));
		});

		if(body != null) {
			req.write(body);
		}

		req.end();
	});
}

module.exports = {
	request
};
