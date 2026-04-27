const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { getProxyForUrl } = require('proxy-from-env');

const REQUEST_TIMEOUT_MS = 30000;
const PROXY_AGENT_CACHE_SIZE = 32;
const proxyAgentCache = new Map();

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
 * Resolve a proxy from environment variables
 * @param {string} targetUrl - request target url
 * @returns {string} proxy url
 */
function getProxyFromEnv(targetUrl) {
	const proxyUrl = getProxyForUrl(targetUrl);
	if(proxyUrl) {
		return proxyUrl;
	}

	const target = new URL(targetUrl);
	if(target.protocol !== 'https:' || !(process.env.http_proxy || process.env.HTTP_PROXY)) {
		return proxyUrl;
	}

	const httpTarget = new URL(targetUrl);
	httpTarget.protocol = 'http:';
	if(!httpTarget.port) {
		httpTarget.port = target.port || '443';
	}

	return getProxyForUrl(httpTarget.href);
}

/**
 * Resolve a proxy URL from explicit options or environment variables
 * @param {string} targetUrl - request target url
 * @param {string|false|undefined} explicitProxy - explicit proxy override
 * @returns {string|null} proxy url
 */
function resolveProxyUrl(targetUrl, explicitProxy) {
	if(explicitProxy === false) {
		return null;
	}

	const proxyValue =
		typeof explicitProxy === 'string' && explicitProxy.trim()
			? explicitProxy.trim()
			: getProxyFromEnv(targetUrl);

	if(!proxyValue) {
		return null;
	}

	const proxyUrl = new URL(proxyValue);
	if(!['http:', 'https:'].includes(proxyUrl.protocol)) {
		throw new Error(`Unsupported proxy protocol "${proxyUrl.protocol}". Only http:// and https:// proxies are supported.`);
	}

	return proxyUrl.href;
}

/**
 * Get a cached proxy agent for a proxy URL
 * @param {string} proxyUrl - resolved proxy url
 * @returns {HttpsProxyAgent} cached proxy agent
 */
function getProxyAgent(proxyUrl) {
	const cachedAgent = proxyAgentCache.get(proxyUrl);
	if(cachedAgent) {
		proxyAgentCache.delete(proxyUrl);
		proxyAgentCache.set(proxyUrl, cachedAgent);

		return cachedAgent;
	}

	const agent = new HttpsProxyAgent(proxyUrl);
	proxyAgentCache.set(proxyUrl, agent);

	if(proxyAgentCache.size > PROXY_AGENT_CACHE_SIZE) {
		const oldestProxyUrl = proxyAgentCache.keys().next().value;
		proxyAgentCache.delete(oldestProxyUrl);
	}

	return agent;
}

/**
 * Build the agent for a request
 * @param {string} targetUrl - request target url
 * @param {object} options - request options
 * @returns {import('https').Agent|undefined} https agent
 */
function resolveAgent(targetUrl, options) {
	const proxyUrl = resolveProxyUrl(targetUrl, options.proxy);
	if(proxyUrl) {
		return getProxyAgent(proxyUrl);
	}

	return options.agent;
}

/**
 * Make an HTTPS request with optional proxy support
 * @param {string} url - request url
 * @param {object} [options] - request options
 * @param {string} [options.method='GET'] - HTTP method
 * @param {object} [options.headers={}] - request headers
 * @param {string|Buffer} [options.body] - request body
 * @param {import('https').Agent} [options.agent] - custom HTTPS agent
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
		agent: resolveAgent(targetUrl.href, options)
	};

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
