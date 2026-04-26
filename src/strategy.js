const { Strategy } = require("passport-strategy");
const assert = require("assert");

const { verifyLogin, buildAuthUrl, canonicalizeRealm } = require("./helpers");

const {
  fetchSteamProfile,
  fetchSteamLevel,
  fetchSteamBans,
} = require("./steam-api");

/**
 * `SteamStrategy` is a class that extends `Strategy` for Steam authentication.
 */
class SteamStrategy extends Strategy {
  /**
   * @param {object} options
   * @param {string} options.realm
   * @param {string} options.returnUrl
   * @param {string|Function} options.apiKey
   * @param {string|false|Function} [options.proxy]
   * @param {boolean} [options.fetchUserProfile=true]
   * @param {boolean} [options.fetchSteamLevel=false]
   * @param {boolean} [options.fetchBans=false]     // // NEW: fetch VAC/community/game bans
   * @param {boolean} [options.passReqToCallback=false]
   * @param {Function} verify
   */
  constructor(options, verify) {
    super();
    this.name = "steam";

    this._verify = verify;
    this._realm = canonicalizeRealm(options.realm);
    this._returnUrl = options.returnUrl;
    this._apiKey = options.apiKey;
    this._proxy = options.proxy;
    this._fetchUserProfile = options.fetchUserProfile ?? true;
    this._fetchSteamLevel = options.fetchSteamLevel ?? false;
    this._fetchBans = options.fetchBans ?? false;
    this._passReqToCallback = options.passReqToCallback ?? false;

    if (!this._realm) {
      throw new Error("OpenID realm is required");
    }
    if (!this._returnUrl) {
      throw new Error("OpenID return URL is required");
    }
    // // API key is required if any Steam Web API calls are enabled
    if (
      (this._fetchUserProfile || this._fetchSteamLevel || this._fetchBans) &&
      !this._apiKey
    ) {
      throw new Error(
        "Steam API key is required to fetch user data. Set fetchUserProfile to false if you do not want to include a Steam API key"
      );
    }

    // // Guard: ensure bans helper exists if enabled
    if (this._fetchBans && typeof fetchSteamBans !== "function") {
      throw new Error(
        "fetchBans is enabled but fetchSteamBans is not exported from ./steam-api"
      );
    }
  }

  /**
   * Resolve the configured proxy value for outbound Steam requests
   * @param {object} [req] - The express request object
   * @param {object} [context] - Extra context for proxy selector functions
   * @returns {Promise<string|false|undefined>} The resolved proxy option
   */
  async resolveProxy(req, context = {}) {
    if (typeof this._proxy !== "function") {
      return this._proxy;
    }

    return await this._proxy(req, context);
  }

  /**
   * Get the correct format of the user data based on options
   * @param {object|string} SteamID - The SteamID object or 64-bit string
   * @param {object} [options] - transport options
   * @returns {Promise<object>} The user data
   */
  async fetchUserData(SteamID, options = {}) {
    // // Accept either SteamID object (with getSteamID64()) or raw 64-bit string
    const steamId64 =
      SteamID && typeof SteamID.getSteamID64 === "function"
        ? SteamID.getSteamID64()
        : String(SteamID);

    if (!this._apiKey) return SteamID;

    const apiKey =
      typeof this._apiKey === "string"
        ? this._apiKey
        : await this._apiKey(SteamID);

    const user = { SteamID };
    const shouldFetchSteamData =
      this._fetchUserProfile || this._fetchSteamLevel || this._fetchBans;
    const { req, ...transportOptions } = options;
    const hasProxyOverride = Object.prototype.hasOwnProperty.call(
      transportOptions,
      "proxy"
    );
    let requestOptions = transportOptions;

    if (shouldFetchSteamData) {
      const proxy = hasProxyOverride
        ? transportOptions.proxy
        : await this.resolveProxy(req, {
            phase: "fetchUserData",
            SteamID,
            steamId64,
          });
      requestOptions = { ...transportOptions, proxy };
    }

    // // Run independent calls in parallel; do not fail the whole login if one auxiliary call fails
    const tasks = [];
    if (this._fetchUserProfile)
      tasks.push(
        fetchSteamProfile(steamId64, apiKey, requestOptions).then((p) => {
          user.profile = p;
        })
      );
    if (this._fetchSteamLevel)
      tasks.push(
        fetchSteamLevel(steamId64, apiKey, requestOptions).then((l) => {
          user.level = l;
        })
      );
    if (this._fetchBans)
      tasks.push(
        fetchSteamBans(steamId64, apiKey, requestOptions).then((b) => {
          user.bans = b;
        })
      );

    if (tasks.length) {
      const results = await Promise.allSettled(tasks);
      const rejected = results.find((r) => r.status === "rejected");
      if (rejected && process.env.NODE_ENV !== "production") {
        console.warn(
          "SteamStrategy: data fetch partial failure:",
          rejected.reason
        );
      }
    }

    return user;
  }

  /**
   * Authenticate the user
   * @param {object} req - The express request object
   * @returns {Promise<void>}
   */
  async authenticate(req) {
    if (!req.query || !req.query["openid.mode"]) {
      const authUrl = buildAuthUrl(this._realm, this._returnUrl);
      return this.redirect(authUrl);
    }

    try {
      // // We only care about the query params, so hostname doesn't matter
      const fullUrl = "https://example.com" + req.url;
      const requestOptions = {
        proxy: await this.resolveProxy(req, { phase: "authenticate" }),
      };
      const userSteamId = await verifyLogin(
        fullUrl,
        this._realm,
        requestOptions
      );
      assert(userSteamId, "Steam validation failed");

      // // Fetch the user's profile/level/bans per options
      const user = await this.fetchUserData(userSteamId, requestOptions);

      if (this._passReqToCallback) {
        this._verify(req, user, (err, userOut) => {
          if (err) {
            return this.error(err); // // internal error -> error(), not fail()
          }
          return this.success(userOut);
        });
      } else {
        this._verify(user, (err, userOut) => {
          if (err) {
            return this.error(err);
          }
          return this.success(userOut);
        });
      }
    } catch (err) {
      return this.error(err);
    }
  }
}

module.exports = SteamStrategy;
